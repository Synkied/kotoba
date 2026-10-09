"""kotoba's speech engine (from jp-shadow-cut): Whisper for scoring and transcription,
Kokoro and VOICEVOX for the model voice. Everything here is optional: without the
`whisper` extra the practice page grades by hand, without `voice` it uses the
browser's voices.

One Whisper model is loaded at a time and `model_lock` serialises its use, so live
scoring, uploads and the recording editor share one GPU without fighting over it."""
import difflib
import importlib.util
import io
import json
import re
import threading
import time
import urllib.error
import wave
from pathlib import Path

from django.conf import settings

from library import romanize

from . import jpcut, jpscore

model_lock = threading.Lock()
_loading = {"key": None, "error": None}
MAX_CLIP_S = 60
PEAKS_PER_SEC = 50


# ---------------------------------------------------------------- Whisper

def whisper_installed():
    return importlib.util.find_spec("faster_whisper") is not None


def _cuda():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001 - no CUDA runtime is the common case
        return False


_preloaded = False


def _preload_cuda_libs():
    """faster-whisper (CTranslate2) needs cuBLAS and cuDNN. When they come from the
    nvidia-* wheels (the `gpu` extra) they aren't on the loader path: load them by hand."""
    global _preloaded
    if _preloaded:
        return
    _preloaded = True
    import ctypes
    spec = importlib.util.find_spec("nvidia")
    for root in (spec.submodule_search_locations or []) if spec else []:
        for lib in ("cublas", "cudnn"):
            for so in sorted((Path(root) / lib / "lib").glob("lib*.so*")):
                try:
                    ctypes.CDLL(str(so), mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def whisper_key(overrides=None):
    """(model, device, compute_type): request overrides, then KOTOBA_WHISPER_*, then
    what suits the machine (large-v3 on a GPU, large-v3-turbo int8 on a CPU)."""
    o = {k: v for k, v in (overrides or {}).items() if v}
    w = {**settings.WHISPER, **o}
    device = w.get("device") or ("cuda" if _cuda() else "cpu")
    gpu = device != "cpu"
    return (w.get("model") or ("large-v3" if gpu else "large-v3-turbo"), device,
            w.get("compute_type") or ("float16" if gpu else "int8"))


def get_model(key):
    if key[1] != "cpu":
        _preload_cuda_libs()
    return jpcut.get_model(*key)


def status(key):
    if not whisper_installed():
        return {"state": "missing", "loaded": None, "error": None, "readings": jpscore.has_readings(),
                "key": list(key)}
    loaded = jpcut._model[0]
    state = ("ready" if loaded == key else "loading" if _loading["key"] == key
             else "error" if _loading["error"] else "idle")
    return {"state": state, "loaded": loaded and list(loaded), "error": _loading["error"],
            "readings": jpscore.has_readings(), "key": list(key)}


def load(key):
    if not whisper_installed() or jpcut._model[0] == key or _loading["key"] == key:
        return
    _loading.update(key=key, error=None)

    def run():
        try:
            with model_lock:
                get_model(key)
        except Exception as e:  # noqa: BLE001 - shown on the practice page
            _loading["error"] = f"{type(e).__name__}: {e}"
        finally:
            _loading["key"] = None
    threading.Thread(target=run, daemon=True).start()


def transcribe(path, key):
    """Whole-file transcription (uploads, recordings): {model, duration, words}."""
    with model_lock:
        get_model(key)
        return jpcut.transcribe(path, *key)


def score(pcm, expected, final, key, busy=lambda: "another clip"):
    """Transcribe one clip (16 kHz mono int16) and score it against `expected`.
    Returns (result, http status)."""
    import numpy as np

    if jpcut._model[0] != key:
        return {**status(key), "error": "model not loaded"}, 409
    # partial results are best-effort: skip them rather than queue behind other work
    if not model_lock.acquire(timeout=30 if final else 0.05):
        return {"error": f"busy transcribing {busy()}"}, 409
    t0 = time.time()
    try:
        audio = np.frombuffer(pcm, "<i2").astype(np.float32) / 32768
        words = (jpscore.transcribe_clip(get_model(key), audio, 5 if final else 1)
                 if len(audio) >= 16000 * 0.25 and jpscore.has_speech(audio) else [])
    finally:
        model_lock.release()
    res = jpscore.score(expected, words)
    res.update(words=words, final=final, seconds=round(len(audio) / 16000, 2),
               latency=round(time.time() - t0, 2))
    return res, 200


def peaks(path):
    """Waveform overview: the loudest sample of every 1/50 s, scaled to 0..1."""
    import numpy as np

    sr = 8000
    audio = jpcut.decode(path, sr)
    step = sr // PEAKS_PER_SEC
    n = len(audio) // step
    if n == 0:
        return {"rate": PEAKS_PER_SEC, "peaks": [], "duration": len(audio) / sr}
    blocks = np.abs(audio[:n * step]).reshape(n, step).max(axis=1)
    top = float(np.percentile(blocks, 99.5)) or 1.0
    vals = np.clip(blocks / top, 0, 1)
    return {"rate": PEAKS_PER_SEC, "duration": len(audio) / sr,
            "peaks": [round(float(v), 3) for v in vals]}


# ---------------------------------------------------------------- read aloud
#   kokoro:<voice>    Kokoro-82M in this process (the `voice` extra). Weights download on
#                     first use.
#   voicevox:<id>     a VOICEVOX / AivisSpeech engine (KOTOBA_VOICEVOX, HTTP API).
# Without either the page falls back to the browser's own Japanese voices.
KOKORO_REPO = "hexgrad/Kokoro-82M"
KOKORO_VOICES = [("jf_alpha", "female"), ("jf_gongitsune", "female"), ("jf_nezumi", "female"),
                 ("jf_tebukuro", "female"), ("jm_kumo", "male")]
_kokoro = {"pipeline": None, "error": None, "loading": False}
_kokoro_lock = threading.Lock()
_tts_cache = {}   # (voice, speed, text) -> wav bytes
_TTS_CACHE_MAX = 200


def _vv(path, params, body=None, timeout=20):
    import urllib.request
    from urllib.parse import urlencode
    base = settings.VOICEVOX_URL
    req = urllib.request.Request(f"{base}{path}?{urlencode(params)}" if params else base + path,
                                 data=body, method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def kokoro_installed():
    return all(importlib.util.find_spec(m) for m in ("kokoro", "misaki", "pyopenjtalk", "fugashi"))


def kokoro_state():
    return ("ready" if _kokoro["pipeline"] else "loading" if _kokoro["loading"]
            else "error" if _kokoro["error"] else "available" if kokoro_installed() else "missing")


def kokoro_load():
    """Start loading Kokoro in the background, so the page can say so while the first
    use downloads the weights instead of hanging on its first sentence."""
    if kokoro_state() in ("available", "error"):
        _kokoro["loading"] = True

        def run():
            try:
                _kokoro_pipeline()
            except RuntimeError:
                pass  # kept in _kokoro["error"]
            finally:
                _kokoro["loading"] = False
        threading.Thread(target=run, daemon=True).start()
    return {"kokoro": kokoro_state(), "kokoro_error": _kokoro["error"]}


def tts_status():
    """Available voices: [{id, name, engine}] plus what's missing, for the hints."""
    voices = []
    kokoro = kokoro_state()
    if kokoro != "missing":
        voices += [{"id": f"kokoro:{v}", "name": f"Kokoro {v[3:]} ({g})", "engine": "kokoro"}
                   for v, g in KOKORO_VOICES]
    try:
        speakers = json.loads(_vv("/speakers", None, timeout=2))
        voices += [{"id": f"voicevox:{st['id']}", "name": f"{sp['name']} ({st['name']})",
                    "engine": "voicevox"}
                   for sp in speakers for st in sp.get("styles", [])
                   if st.get("type", "talk") == "talk"]
        vv = True
    except Exception:  # noqa: BLE001 - VOICEVOX not running
        vv = False
    return {"voices": voices, "kokoro": kokoro, "kokoro_error": _kokoro["error"],
            "voicevox": vv, "voicevox_url": settings.VOICEVOX_URL}


def _kokoro_pipeline():
    with _kokoro_lock:
        if _kokoro["pipeline"] is None:
            try:
                from kokoro import KPipeline
                pipe = KPipeline(lang_code="j", repo_id=KOKORO_REPO)
            except Exception as e:
                msg = str(e)
                if isinstance(e, ImportError):
                    msg = f"{msg}: install kotoba's voice extra"
                elif "mecab" in msg.lower() or "unidic" in msg.lower():
                    msg = "the UniDic dictionary is missing: run  python -m unidic download"
                _kokoro["error"] = f"Kokoro failed to load: {msg}"
                raise RuntimeError(_kokoro["error"]) from e
            _kokoro["pipeline"], _kokoro["error"] = pipe, None
        return _kokoro["pipeline"]


def _kokoro_wav(text, voice, speed):
    import numpy as np

    pipe = _kokoro_pipeline()
    with _kokoro_lock:  # one synthesis at a time
        chunks = [r.audio.detach().cpu().numpy() if hasattr(r.audio, "detach") else np.asarray(r.audio)
                  for r in pipe(text, voice=voice, speed=speed) if r.audio is not None]
    if not chunks:
        raise RuntimeError("Kokoro produced no audio for this text")
    pcm = (np.clip(np.concatenate(chunks), -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


_SMALL = "ァィゥェォャュョヮ"
_VOWEL_KANA = dict(zip("aiueo", "アイウエオ"))


def _vowel(c):
    if c in _SMALL:
        return "aiueoauoa"[_SMALL.index(c)]
    r = romanize._kana(romanize._hira(c))
    return r[-1] if r[-1:] in tuple("aiueo") else ""


def _plain_kana(chars):
    """ー spelled as its vowel and ヲ as オ, which VOICEVOX's kana notation always accepts;
    plus a stricter form for comparing, where トウ and トー (and ケイ and ケー) agree."""
    plain, strict, prev = [], [], ""
    for c in chars:
        if c == "ヲ":
            c = "オ"
        elif c == "ー" and prev:
            c = _VOWEL_KANA[prev]
        plain.append(c)
        strict.append("オ" if c == "ウ" and prev == "o" else "エ" if c == "イ" and prev == "e" else c)
        prev = _vowel(c)
    return plain, strict


def _voicevox_kana(kana, said):
    """VOICEVOX's own reading (its AquesTalk-style kana: ' accent, / and 、 phrase
    breaks, _ devoicing) with the morae it reads differently from `said`, the furigana
    reading, swapped for ours; marks are kept, so the accent stays VOICEVOX's.
    None when they already agree."""
    chars, before, after, pending = [], [], [], ""
    for c in kana:
        if c == "_":
            pending = c
        elif c in "'/、？?":
            if after:
                after[-1] += c
        else:
            chars.append(c)
            before.append(pending)
            after.append("")
            pending = ""
    ours = [c if "ァ" <= c <= "ヴ" or c == "ー" else "\0" for c in said
            if c.isalnum() or "ァ" <= c <= "ヴ" or c == "ー"]  # \0: unknown, e.g. digits
    vv_plain, vv_strict = _plain_kana(chars)
    our_plain, our_strict = _plain_kana(ours)
    match = difflib.SequenceMatcher(None, vv_strict, our_strict, autojunk=False)
    if vv_strict == our_strict:
        return None
    out = []  # [before, mora, after]
    for tag, i1, i2, j1, j2 in match.get_opcodes():
        if tag == "equal" or "\0" in our_strict[j1:j2]:
            out.extend([before[i], chars[i], after[i]] for i in range(i1, i2))
            continue
        new = [["", c, ""] for c in our_plain[j1:j2]]
        for k in range(i1, i2):  # keep accent and phrase marks where they were, counting from the end
            target = new[max(0, len(new) - (i2 - k))] if new else out[-1] if out else None
            if target is not None:
                target[2] += "".join(m for m in after[k] if m not in target[2])
        out.extend(new)
    text = re.sub("'([%s])" % _SMALL, r"\1'", "".join(b + c + a for b, c, a in out))  # キ'ャ -> キャ'
    return None if text == kana else text


def _voicevox_wav(text, speaker, speed, said=None):
    try:
        query = json.loads(_vv("/audio_query", {"text": text, "speaker": speaker}, b""))
        kana = said and _voicevox_kana(query.get("kana", ""), said)
        if kana:
            try:
                query["accent_phrases"] = json.loads(_vv(
                    "/accent_phrases", {"text": kana, "speaker": speaker, "is_kana": "true"}, b""))
            except urllib.error.HTTPError:
                pass  # kana it would not parse: keep its own reading
        query["speedScale"] = speed
        query["prePhonemeLength"] = query["postPhonemeLength"] = 0.1
        return _vv("/synthesis", {"speaker": speaker}, json.dumps(query).encode(), timeout=60)
    except OSError as e:
        raise RuntimeError(f"VOICEVOX at {settings.VOICEVOX_URL} is not answering ({e})") from e


def tts(text, voice, speed, readings=None):
    """Speech for text, saying the kanji as the furigana do: `readings` are a sentence's
    [kanji, reading] pairs (its saved corrections included), else they're computed."""
    text = text.strip()[:300]
    if not text:
        raise ValueError("empty text")
    speed = min(2.0, max(0.5, float(speed)))
    engine, _, name = voice.partition(":")
    if readings is None:
        readings = romanize.furigana(text)
    key = (voice, speed, text, json.dumps(readings, ensure_ascii=False))
    if key not in _tts_cache:
        if engine == "kokoro" and name in dict(KOKORO_VOICES):
            wav = _kokoro_wav(romanize.with_readings(text, readings), name, speed)
        elif engine == "voicevox" and name.isdigit():
            wav = _voicevox_wav(text, int(name), speed, romanize.spoken(text, readings))
        else:
            raise ValueError(f"unknown voice {voice!r}")
        if len(_tts_cache) >= _TTS_CACHE_MAX:
            _tts_cache.pop(next(iter(_tts_cache)))
        _tts_cache[key] = wav
    return _tts_cache[key]
