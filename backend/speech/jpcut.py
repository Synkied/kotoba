"""jpcut - (from jp-shadow-cut) automatically clean up Japanese speaking-practice recordings.

Transcribes locally with faster-whisper (GPU), then removes:
  * retakes: say the cue word (default 「リテイク」) after a mistake and the
    current sentence (or the previous one, if you paused before the cue) is cut
    together with the cue itself
  * fillers: えーと, えっと, あのー, うーん, まー ...
  * repeats / false starts: if a sentence is followed by a similar one, only
    the last attempt is kept
  * long pauses: shortened to --max-pause seconds
  * with a script (the text you were reading): speech that is not in it is
    cut, and for each script sentence only the last complete take is kept
    (this replaces the repeat detection above)

Outputs go in a folder per recording, <name>/, next to the input (or inside
--out-dir):
  <name>/<name>_clean.wav       the cleaned audio
  <name>/<name>_cuts.txt        Audacity label track of every cut (for review)
  <name>/<name>_transcript.txt  transcript with removed parts marked ⟦reason:text⟧
  <name>/<name>.words.json      cached transcription (re-runs skip the model)

The script is read from --script, else <name>/<name>_script.txt, else <name>.txt
next to the recording. One sentence per line or 。-separated; kana/kanji spelled
the way Whisper writes them matches best.

Review workflow:
  1. python -m speech.jpcut rec.wav
  2. In Audacity: open rec.wav, File > Import > Labels > rec/rec_cuts.txt,
     fix/delete labels, File > Export > Export Labels (overwrite rec/rec_cuts.txt)
  3. python -m speech.jpcut rec.wav --apply-labels
"""
import argparse
import difflib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import threading

SR = 48000

# Progress lines go to the job that is running in this thread (kotoba's job log),
# else to stderr.
_sink = threading.local()


def log(msg):
    out = getattr(_sink, "out", None)
    if out is not None:
        out(str(msg))
    else:
        print(msg, file=sys.stderr)
PUNCT = set("、。，．,.!?！？…「」『』（）()・〜~ 　\"'")
SENTENCE_END = set("。！？!?")

# Whisper tends to "clean up" disfluencies; a prompt full of fillers nudges it
# into transcribing them verbatim so they can be cut.
FILLER_PROMPT = "えーと、あのー、えっと、まあ、うーん、その、えー、あー、なんか。"

DEFAULT_CUES = ["リテイク", "りていく", "リテーク", "retake"]
DEFAULT_FILLERS = [
    r"え[ーぇ〜]+っ?と?",
    r"えっと",
    r"あの[ーぉ〜]+",
    r"その[ーぉ〜]+",
    r"あ[ーぁ〜]+",
    r"う[ーぅ〜]+ん?",
    r"ん[ーん〜]+",
    r"ま[ーぁ〜]+",
]


# ---------------------------------------------------------------- transcription

_model = (None, None)


def get_model(model_name, device, compute_type):
    """Load a faster-whisper model, reusing the last one (the web UI asks repeatedly)."""
    global _model
    key = (model_name, device, compute_type)
    if _model[0] != key:
        from faster_whisper import WhisperModel

        log(f"Loading {model_name} on {device}...")
        _model = (None, None)  # free the previous model before loading another
        _model = (key, WhisperModel(model_name, device=device, compute_type=compute_type))
    return _model[1]


def transcribe(path, model_name, device, compute_type):
    model = get_model(model_name, device, compute_type)
    # Decode with ffmpeg ourselves: faster-whisper's PyAV decoding breaks with
    # some PyAV versions (e.g. "unexpected keyword argument 'metadata_errors'").
    segments, info = model.transcribe(
        decode(path, 16000),
        language="ja",
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=5,
    )
    words = []
    for seg in segments:
        log(f"  [{seg.start:7.2f}] {seg.text}")
        for w in seg.words or []:
            words.append({"word": w.word, "start": w.start, "end": w.end})
    return {"model": model_name, "duration": info.duration, "words": words}


def load_or_transcribe(path, cache, args):
    if cache.exists() and not args.retranscribe:
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("model") == args.model:
            log(f"Using cached transcription {cache.name}")
            return data
    data = transcribe(path, args.model, args.device, args.compute_type)
    cache.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


# ---------------------------------------------------------------- cut analysis

class Timeline:
    """Character-level view of the transcript, each char with a time span.

    Whisper's Japanese "words" are arbitrary token chunks, so fillers and cue
    words may be split across or merged into them. Working on characters lets
    us regex-match the full text and map matches back to times.
    """

    def __init__(self, words, utt_gap):
        self.chars, self.cs, self.ce = [], [], []
        for w in words:
            text = unicodedata.normalize("NFKC", w["word"]).replace(" ", "")
            if not text:
                continue
            spoken = [c for c in text if c not in PUNCT] or [None]
            step = (w["end"] - w["start"]) / len(spoken)
            t = w["start"]
            for c in text:
                self.chars.append(c)
                self.cs.append(t)
                if c not in PUNCT:
                    t += step
                self.ce.append(t)
        self.text = "".join(self.chars)
        self.cut = [None] * len(self.chars)  # reason per char, None = kept
        self.utts = self._split_utterances(utt_gap)

    def is_spoken(self, i):
        return self.chars[i] not in PUNCT

    def _split_utterances(self, gap):
        utts, start, last_end = [], 0, None
        for i, c in enumerate(self.chars):
            if self.is_spoken(i):
                if last_end is not None and self.cs[i] - last_end > gap and i > start:
                    utts.append((start, i))
                    start = i
                last_end = self.ce[i]
            if c in SENTENCE_END:
                utts.append((start, i + 1))
                start = i + 1
        if start < len(self.chars):
            utts.append((start, len(self.chars)))
        return [u for u in utts if any(self.is_spoken(i) for i in range(*u))]

    def utt_index(self, char_i):
        for k, (a, b) in enumerate(self.utts):
            if a <= char_i < b:
                return k
        return len(self.utts) - 1

    def mark(self, a, b, reason):
        for i in range(a, b):
            if self.cut[i] is None:
                self.cut[i] = reason

    def kept_text(self, a, b):
        return "".join(self.chars[i] for i in range(a, b)
                       if self.cut[i] is None and self.is_spoken(i))


def eat_punct(tl, i):
    while i < len(tl.chars) and not tl.is_spoken(i):
        i += 1
    return i


# ---------------------------------------------------------------- script

SCRIPT_SENTENCE = re.compile(r"[^\n。！？!?]+[。！？!?」』]*")


def loose(text):
    """Comparison form: NFKC, no punctuation/spaces/long vowels, katakana as hiragana."""
    out = []
    for c in unicodedata.normalize("NFKC", text):
        if c in PUNCT or c.isspace() or c == "ー":
            continue
        if "ァ" <= c <= "ヶ":
            c = chr(ord(c) - 0x60)
        out.append(c)
    return "".join(out)


def parse_script(text):
    """Split a script into sentences: [(display text, comparison form)]."""
    out = []
    for line in text.splitlines():
        for m in SCRIPT_SENTENCE.finditer(line):
            shown = m.group().strip()
            if loose(shown):
                out.append((shown, loose(shown)))
    return out


def read_script(path):
    """Scripts may come from Windows/Japanese editors: accept UTF-8 (BOM) or Shift-JIS."""
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def find_script(src, folder):
    for p in (folder / f"{src.stem}_script.txt", src.with_suffix(".txt")):
        if p.exists():
            return p
    return None


def _match(said, sent):
    """How much of `said` is in `sent`: (precision, covered sentence positions, start)."""
    sm = difflib.SequenceMatcher(None, said, sent, autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size]
    covered = {i for b in blocks for i in range(b.b, b.b + b.size)}
    start = next((b.b for b in blocks if b.size >= 2), blocks[0].b if blocks else len(sent))
    return sum(b.size for b in blocks) / len(said), covered, start


def apply_script(tl, script, min_match=0.5, complete=0.8):
    """Cut off-script utterances and every take of a sentence but the last complete one.

    Returns one report entry per script sentence: its status ("ok", "partial",
    "missing"), coverage of the kept take and that take's time span.
    """
    sents = [n for _, n in script]
    utts = [(k, loose(tl.kept_text(a, b))) for k, (a, b) in enumerate(tl.utts)]
    utts = [(k, t) for k, t in utts if t]

    # 1. assign each utterance to a script sentence, reading roughly in order
    ptr, assigned = 0, []
    for k, said in utts:
        best = None
        for j in range(max(0, ptr - 2), min(len(sents), ptr + 4)):
            prec, cov, start = _match(said, sents[j])
            score = prec - 0.02 * abs(j - ptr)
            if best is None or score > best[0]:
                best = (score, prec, j, cov, start)
        if best is None or best[1] < min_match:
            # lost our place? (skipped sentences, started elsewhere)
            for j in range(len(sents)):
                prec, cov, start = _match(said, sents[j])
                if prec >= max(min_match, 0.7) and (best is None or prec > best[1]):
                    best = (prec, prec, j, cov, start)
        if best is None or best[1] < min_match:
            tl.mark(*tl.utts[k], "offscript")
            continue
        _, _, j, cov, start = best
        assigned.append((k, j, cov, start))
        ptr = j

    # 2. group consecutive utterances of a sentence into takes; a take restarts
    #    when the reader goes back to an earlier point of the sentence
    takes = {}  # sentence -> [[utt indices], covered positions]
    prev_j = None
    for k, j, cov, start in assigned:
        chain = takes.get(j, [])
        if (prev_j == j and chain and start >= max(chain[-1][1], default=-1) - 1):
            chain[-1][0].append(k)
            chain[-1][1] |= cov
        else:
            chain.append([[k], set(cov)])
        takes[j] = chain
        prev_j = j

    # 3. keep the last complete take (or the most complete one), cut the others
    report = []
    for j, (shown, sent) in enumerate(script):
        chain = takes.get(j, [])
        if not chain:
            report.append({"text": shown, "status": "missing", "coverage": 0.0,
                           "takes": 0, "start": None, "end": None})
            continue
        ratios = [len(c[1]) / len(sent) for c in chain]
        good = [i for i, r in enumerate(ratios) if r >= complete]
        keep = good[-1] if good else max(range(len(chain)), key=lambda i: (ratios[i], i))
        for i, (ks, _) in enumerate(chain):
            if i != keep:
                for k in ks:
                    tl.mark(*tl.utts[k], "retry")
        ks = chain[keep][0]
        a, b = tl.utts[ks[0]][0], tl.utts[ks[-1]][1]
        spoken = [i for i in range(a, b) if tl.is_spoken(i) and tl.cut[i] is None]
        report.append({
            "text": shown, "status": "ok" if ratios[keep] >= complete else "partial",
            "coverage": round(ratios[keep], 2), "takes": len(chain),
            "start": round(tl.cs[spoken[0]], 3) if spoken else None,
            "end": round(tl.ce[spoken[-1]], 3) if spoken else None,
        })
    return report


def script_summary(report):
    lines = ["", "# script"]
    for r in report:
        when = f"{r['start']:7.2f}" if r["start"] is not None else "      -"
        mark = {"ok": " ", "partial": "~", "missing": "!"}[r["status"]]
        extra = f"  ({r['status']}, {r['coverage']:.0%})" if r["status"] != "ok" else ""
        lines.append(f"[{when}] {mark} {r['text']}{extra}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- cue/filler/repeat

def apply_cues(tl, cues, cue_back):
    if not cues:
        return
    pattern = re.compile("|".join(re.escape(c) for c in cues), re.IGNORECASE)
    for m in pattern.finditer(tl.text):
        k = tl.utt_index(m.start())
        a = tl.utts[k][0]
        before = tl.kept_text(a, m.start())
        # Cue said on its own after a pause -> the failed attempt is the
        # previous utterance(s).
        back = cue_back if not before else cue_back - 1
        a = tl.utts[max(0, k - back)][0]
        tl.mark(a, eat_punct(tl, m.end()), "retake")


def apply_fillers(tl, fillers):
    if not fillers:
        return
    pattern = re.compile("(?:" + "|".join(fillers) + ")[、,…]*")
    for m in pattern.finditer(tl.text):
        tl.mark(m.start(), m.end(), "filler")


def apply_repeats(tl, threshold):
    live = [k for k, (a, b) in enumerate(tl.utts) if tl.kept_text(a, b)]
    for k, nxt in zip(live, live[1:]):
        a_txt = tl.kept_text(*tl.utts[k])
        b_txt = tl.kept_text(*tl.utts[nxt])
        if len(a_txt) < 2:
            continue
        head = b_txt[:len(a_txt)]
        if len(a_txt) < 4:
            similar = head == a_txt
        else:
            similar = (difflib.SequenceMatcher(None, a_txt, head).ratio() >= threshold
                       or difflib.SequenceMatcher(None, a_txt, b_txt).ratio() >= threshold)
        if similar:
            tl.mark(*tl.utts[k], "repeat")


def cut_intervals(tl, duration, pad, max_pause, lead):
    """Turn per-char cut marks + silences into merged (start, end, reason)."""
    spoken = [i for i in range(len(tl.chars)) if tl.is_spoken(i)]
    kept = [i for i in spoken if tl.cut[i] is None]
    out = []

    # Content cuts: snap to the neighbouring kept chars, leaving `pad` seconds.
    i = 0
    while i < len(spoken):
        ci = spoken[i]
        if tl.cut[ci] is None:
            i += 1
            continue
        j = i
        reasons = []
        while j < len(spoken) and tl.cut[spoken[j]] is not None:
            if tl.cut[spoken[j]] not in reasons:
                reasons.append(tl.cut[spoken[j]])
            j += 1
        first, last = spoken[i], spoken[j - 1]
        prev_end = tl.ce[spoken[i - 1]] if i > 0 else 0.0
        next_start = tl.cs[spoken[j]] if j < len(spoken) else duration
        start = min(tl.cs[first], prev_end + pad) if i > 0 else 0.0
        end = max(tl.ce[last], next_start - pad) if j < len(spoken) else duration
        cut_text = "".join(tl.chars[first:last + 1])
        out.append((start, end, f"{'+'.join(reasons)}: {cut_text}"))
        i = j

    # Long pauses between kept speech.
    if kept:
        if tl.cs[kept[0]] > lead:
            out.append((0.0, tl.cs[kept[0]] - lead, "pause"))
        for p, q in zip(kept, kept[1:]):
            gap_a, gap_b = tl.ce[p], tl.cs[q]
            if gap_b - gap_a > max_pause:
                out.append((gap_a + max_pause / 2, gap_b - max_pause / 2, "pause"))
        if duration - tl.ce[kept[-1]] > lead:
            out.append((tl.ce[kept[-1]] + lead, duration, "pause"))

    return merge(out)


def merge(intervals):
    merged = []
    for s, e, r in sorted(intervals):
        if e - s <= 0:
            continue
        if merged and s <= merged[-1][1]:
            ps, pe, pr = merged[-1]
            if r != "pause" and pr != "pause":
                pr = f"{pr} | {r}"
            elif pr == "pause":
                pr = r
            merged[-1] = (ps, max(pe, e), pr)
        else:
            merged.append((s, e, r))
    return merged


def annotated_transcript(tl):
    lines = []
    for a, b in tl.utts:
        parts, i = [], a
        while i < b:
            r = tl.cut[i]
            j = i
            while j < b and tl.cut[j] == r:
                j += 1
            chunk = "".join(tl.chars[i:j])
            parts.append(chunk if r is None else f"⟦{r}:{chunk}⟧")
            i = j
        lines.append(f"[{tl.cs[a]:7.2f}] " + "".join(parts))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- labels / audio

def write_labels(path, intervals):
    with open(path, "w", encoding="utf-8") as f:
        for s, e, r in intervals:
            f.write(f"{s:.3f}\t{e:.3f}\t{r}\n")


def read_labels(path):
    out = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        # Audacity may add "\" frequency lines for spectral labels; skip them.
        if len(parts) < 2 or line.startswith("\\"):
            continue
        out.append((float(parts[0]), float(parts[1]), parts[2] if len(parts) > 2 else ""))
    return merge(out)


def probe_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def decode(path, sr):
    """Decode any audio/video file to mono float32 samples at `sr` Hz."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr),
         "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def render(src, dst, cuts, fade=0.008):
    import numpy as np

    audio = decode(src, SR)
    dur = len(audio) / SR

    keep, t = [], 0.0
    for s, e, _ in cuts:
        if s > t:
            keep.append((t, s))
        t = max(t, e)
    if t < dur:
        keep.append((t, dur))

    nf = int(fade * SR)
    ramp = np.linspace(0, 1, nf, dtype=np.float32)
    pieces = []
    for s, e in keep:
        seg = audio[int(s * SR):int(e * SR)].copy()
        if len(seg) < 2 * nf or e - s < 0.03:
            continue
        seg[:nf] *= ramp
        seg[-nf:] *= ramp[::-1]
        pieces.append(seg)
    out = np.concatenate(pieces) if pieces else np.zeros(0, np.float32)

    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1",
         "-i", "-", str(dst)], input=out.tobytes(), check=True)
    log(f"Wrote {dst}  ({dur:.1f}s -> {len(out) / SR:.1f}s)")


# ---------------------------------------------------------------- main

def build_parser():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path)
    p.add_argument("--out-dir", type=Path,
                   help="where to create the <name>/ output folder (default: next to input)")
    p.add_argument("-o", "--output", type=Path,
                   help="output audio (default <name>/<name>_clean.wav)")
    p.add_argument("--apply-labels", type=Path, nargs="?", const=True,
                   help="skip analysis; cut exactly the intervals in this Audacity label "
                        "file (default <name>/<name>_cuts.txt)")
    p.add_argument("--dry-run", action="store_true", help="write labels/transcript, no audio")

    g = p.add_argument_group("transcription")
    g.add_argument("--model", default="large-v3",
                   help="faster-whisper model, e.g. large-v3, large-v3-turbo, "
                        "kotoba-tech/kotoba-whisper-v2.0-faster (default large-v3)")
    g.add_argument("--device", default="cuda")
    g.add_argument("--compute-type", default="float16")
    g.add_argument("--retranscribe", action="store_true", help="ignore cached .words.json")

    g = p.add_argument_group("cutting")
    g.add_argument("--cue", action="append",
                   help=f"retake cue word, repeatable (default: {' '.join(DEFAULT_CUES)})")
    g.add_argument("--cue-back", type=int, default=1,
                   help="utterances to remove before a cue said after a pause (default 1)")
    g.add_argument("--filler", action="append",
                   help="extra filler regex, repeatable (added to the built-in list)")
    g.add_argument("--no-fillers", action="store_true")
    g.add_argument("--no-repeats", action="store_true")
    g.add_argument("--repeat-threshold", type=float, default=0.75,
                   help="similarity (0-1) above which an attempt counts as a repeat")
    g.add_argument("--utt-gap", type=float, default=0.6,
                   help="pause (s) that separates two utterances/attempts")
    g.add_argument("--max-pause", type=float, default=0.5,
                   help="longer pauses are shortened to this (s)")
    g.add_argument("--pad", type=float, default=0.12,
                   help="silence (s) kept around each content cut")
    g.add_argument("--lead", type=float, default=0.3,
                   help="silence (s) kept at start and end")

    g = p.add_argument_group("script")
    g.add_argument("--script", type=Path,
                   help="text you were reading (default <name>/<name>_script.txt or <name>.txt)")
    g.add_argument("--no-script", action="store_true", help="ignore any script")
    g.add_argument("--script-match", type=float, default=0.5,
                   help="share (0-1) of an utterance that must be in the script to keep it")
    return p


def analyze(data, duration, args, script=None):
    """Mark cuts on the transcript; returns (timeline, merged cut intervals).

    With a script (parse_script output), tl.script_report holds per-sentence results.
    """
    tl = Timeline(data["words"], args.utt_gap)
    tl.script_report = None
    apply_cues(tl, args.cue or DEFAULT_CUES, args.cue_back)
    if not args.no_fillers:
        apply_fillers(tl, DEFAULT_FILLERS + (args.filler or []))
    if script:
        tl.script_report = apply_script(tl, script, args.script_match)
    elif not args.no_repeats:
        apply_repeats(tl, args.repeat_threshold)
    return tl, cut_intervals(tl, duration, args.pad, args.max_pause, args.lead)


def main():
    args = build_parser().parse_args()

    src = args.input
    name = src.stem
    folder = (args.out_dir or src.parent) / name
    folder.mkdir(parents=True, exist_ok=True)
    dst = args.output or folder / f"{name}_clean.wav"
    labels = folder / f"{name}_cuts.txt"
    transcript = folder / f"{name}_transcript.txt"

    if args.apply_labels:
        render(src, dst, read_labels(labels if args.apply_labels is True else args.apply_labels))
        return

    data = load_or_transcribe(src, folder / f"{name}.words.json", args)
    duration = data.get("duration") or probe_duration(src)
    script_path = None if args.no_script else args.script or find_script(src, folder)
    script = parse_script(read_script(script_path)) if script_path else None
    if script:
        log(f"Using script {script_path} ({len(script)} sentences)")
    tl, cuts = analyze(data, duration, args, script)
    text = annotated_transcript(tl)
    if tl.script_report:
        text += script_summary(tl.script_report)
    write_labels(labels, cuts)
    transcript.write_text(text, encoding="utf-8")
    log(text)
    n = sum(1 for c in cuts if c[2] != "pause")
    print(f"{n} content cuts, {len(cuts) - n} pause trims -> {labels.name}, {transcript.name}",
          file=sys.stderr)

    if not args.dry_run:
        render(src, dst, cuts)


if __name__ == "__main__":
    main()
