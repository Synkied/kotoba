"""jpscore - score one spoken attempt at a Japanese sentence (live practice).

What you said (faster-whisper words with confidences) is aligned with the
sentence you meant to read:

  * written forms are compared first; where they differ (今日 vs きょう) the
    readings are compared instead, so kanji/kana spelling doesn't count as a
    mistake. Readings come from pykakasi when installed (pip install pykakasi);
    without it only kana/katakana differences are forgiven.
  * accuracy: share of the sentence said correctly, minus extra words
  * clarity: how confidently Whisper heard the words you got right. This is a
    proxy for pronunciation, not a phonetic assessment.
  * fluency: fillers (えーと...) and long pauses inside the sentence
"""
import difflib
import re
import unicodedata

from . import jpcut

try:
    import pykakasi
    _kks = pykakasi.kakasi()
except ImportError:
    _kks = None

UNCLEAR = 0.55      # word confidence below this is flagged as unclear
LONG_PAUSE = 0.6    # seconds of silence inside a sentence that count as a hesitation
_FILLER_RE = re.compile("(?:" + "|".join(jpcut.DEFAULT_FILLERS) + ")")


def has_readings():
    return _kks is not None


def _key(c):
    """Comparison form of one character ('' if it doesn't count)."""
    return jpcut.loose(c)


def _has_kanji(s):
    return any("一" <= c <= "鿿" or c in "々〆ヶ" for c in s)


def reading(text):
    """Hiragana reading, in comparison form."""
    if _kks is None:
        return jpcut.loose(text)
    return jpcut.loose("".join(item["hira"] for item in _kks.convert(text)))


def _readings(us, exp, exp_unit, b1, b2):
    """Candidate readings of expected chars b1..b2 (whole units): the sentence-level
    furigana, the stretch read on its own, and kanji runs read separately. pykakasi
    gets some words wrong in one way but not the others (今日は -> こんにちは)."""
    text = "".join(exp[b1:b2])
    ruby = ""
    for ui in sorted(set(exp_unit[b1:b2]), key=exp_unit[b1:b2].index):
        ruby += us[ui].get("reading") or "".join(us[ui]["keys"])
    runs = re.findall(r"[\u4e00-\u9fff々〆ヶ]+|[^\u4e00-\u9fff々〆ヶ]+", text)
    return {jpcut.loose(ruby), reading(text), "".join(reading(r) for r in runs)}


def _furigana(orig, hira):
    """Split a kanji word into kana before / kanji core / kana after, with the
    core's reading: 行き -> ("", 行, い, き). Compounds are read on their own,
    which avoids phrase readings like 今日は -> こんにちは."""
    i = 0
    while i < len(orig) and not _has_kanji(orig[i]):
        i += 1
    j = len(orig)
    while j > i and not _has_kanji(orig[j - 1]):
        j -= 1
    head, core, tail = orig[:i], orig[i:j], orig[j:]
    h_head, h_tail = jpcut.loose(head), jpcut.loose(tail)
    ruby = jpcut.loose(hira)
    if ruby.startswith(h_head) and ruby.endswith(h_tail) and len(ruby) > len(h_head) + len(h_tail):
        ruby = ruby[len(h_head):len(ruby) - len(h_tail)]
    if (head or tail) and len(core) >= 2 and all(_has_kanji(c) for c in core):
        ruby = reading(core) or ruby
    return head, core, ruby, tail


def units(sentence):
    """Display units of a sentence: kanji words with their reading (for furigana),
    every other character on its own.
    [{"text", "head", "base", "ruby", "tail", "reading", "keys": [key chars]}]"""
    out = []
    parts = _kks.convert(sentence) if _kks else [{"orig": c, "hira": c} for c in sentence]
    for item in parts:
        orig = item["orig"]
        if _has_kanji(orig):
            head, core, ruby, tail = _furigana(orig, item["hira"])
            out.append({"text": orig, "head": head, "base": core, "ruby": ruby, "tail": tail,
                        "reading": jpcut.loose(head) + ruby + jpcut.loose(tail),
                        "keys": list(_key(orig))})
        else:
            for c in orig:
                out.append({"text": c, "ruby": None, "keys": list(_key(c))})
    return out


def prepare(text):
    """Script -> sentences with display units, for the practice page."""
    return [{"text": shown, "units": [_display(u) for u in units(shown)]}
            for shown, _ in jpcut.parse_script(text)]


def _display(u):
    return {k: u.get(k) for k in ("text", "head", "base", "ruby", "tail")}


def score(sentence, words):
    """Score an attempt. `words`: [{"word", "start", "end", "probability"}]."""
    us = units(sentence)
    exp, exp_unit = [], []  # expected key chars and the unit each belongs to
    for ui, u in enumerate(us):
        for k in u["keys"]:
            exp.append(k)
            exp_unit.append(ui)

    # what was said, char by char, with the confidence of its word
    raw, raw_word = [], []
    for wi, w in enumerate(words):
        for c in unicodedata.normalize("NFKC", w["word"]):
            raw.append(c)
            raw_word.append(wi)
    said_text = "".join(raw)
    filler = [False] * len(raw)
    fillers = []
    for m in _FILLER_RE.finditer(said_text):
        fillers.append(m.group())
        for i in range(m.start(), m.end()):
            filler[i] = True
    said, said_prob, said_raw = [], [], []
    for i, c in enumerate(raw):
        if filler[i]:
            continue
        for k in _key(c):
            said.append(k)
            said_prob.append(words[raw_word[i]].get("probability", 1.0))
            said_raw.append(i)

    # align written forms; differing stretches get a second chance on readings
    matched = [None] * len(exp)  # confidence of the said char matched to each expected char
    said_of = {}                 # expected index -> said index, for exact matches
    regions = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, said, exp, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                matched[j1 + k] = said_prob[i1 + k]
                said_of[j1 + k] = i1 + k
        elif regions and regions[-1][1] == i1 and regions[-1][3] == j1:
            regions[-1] = (regions[-1][0], i2, regions[-1][2], j2)
        else:
            regions.append((i1, i2, j1, j2))

    used = set(said_of.values())
    for a1, a2, b1, b2 in regions:
        if a2 == a1:
            continue  # nothing said here: plain omission
        # widen to whole words of the sentence: readings depend on context (行き = いき)
        while b1 > 0 and exp_unit[b1 - 1] == exp_unit[b1 if b1 < len(exp) else b1 - 1]:
            b1 -= 1
        while 0 < b2 < len(exp) and exp_unit[b2] == exp_unit[b2 - 1]:
            b2 += 1
        inside = [said_of[j] for j in range(b1, b2) if j in said_of]
        a1, a2 = min([a1] + inside), max([a2] + [i + 1 for i in inside])
        s_read = reading("".join(said[a1:a2]))
        if s_read and b2 > b1 and any(
                s_read == r or difflib.SequenceMatcher(None, s_read, r).ratio() >= 0.85
                for r in _readings(us, exp, exp_unit, b1, b2)):
            p = sum(said_prob[a1:a2]) / (a2 - a1)
            for j in range(b1, b2):
                matched[j] = p
            used.update(range(a1, a2))
    extra = [i for i in range(len(said)) if i not in used]

    # per display unit
    unit_out = []
    for ui, u in enumerate(us):
        idx = [j for j, x in enumerate(exp_unit) if x == ui]
        got = [matched[j] for j in idx if matched[j] is not None]
        if not idx:
            status = "punct"
        elif len(got) == len(idx):
            status = "unclear" if min(got) < UNCLEAR else "ok"
        elif got:
            status = "partial"
        else:
            status = "missed"
        unit_out.append({**_display(u), "status": status,
                         "conf": round(sum(got) / len(got), 2) if got else None})

    # extra words, grouped back into what Whisper wrote
    extra_words = []
    for wi in sorted({raw_word[said_raw[i]] for i in extra}):
        t = jpcut.loose(words[wi]["word"])
        if t and (not extra_words or extra_words[-1][0] != wi):
            extra_words.append((wi, words[wi]["word"].strip()))

    n_ok = sum(1 for m in matched if m is not None)
    accuracy = n_ok / (len(exp) + len(extra)) if exp else 0.0
    confs = [m for m in matched if m is not None]
    clarity = sum(confs) / len(confs) if confs else 0.0
    pauses = sum(1 for a, b in zip(words, words[1:]) if b["start"] - a["end"] > LONG_PAUSE)
    fluency = max(0.0, 1 - 0.15 * len(fillers) - 0.1 * pauses)
    spoken = [w for w in words if jpcut.loose(w["word"])]
    dur = (spoken[-1]["end"] - spoken[0]["start"]) if spoken else 0
    # accuracy gates the total: clearly saying the wrong thing shouldn't score well
    overall = accuracy * (0.6 + 0.4 * (0.6 * clarity + 0.4 * fluency))

    return {
        "said": said_text.strip(),
        "overall": round(100 * overall),
        "accuracy": round(100 * accuracy),
        "clarity": round(100 * clarity),
        "fluency": round(100 * fluency),
        "progress": round(max((j + 1 for j, m in enumerate(matched) if m is not None),
                              default=0) / len(exp), 2) if exp else 0,
        "units": unit_out,
        "missed": [u["text"] for u in unit_out if u["status"] in ("missed", "partial")],
        "unclear": [u["text"] for u in unit_out if u["status"] == "unclear"],
        "extra": [t for _, t in extra_words],
        "fillers": fillers,
        "pauses": pauses,
        "rate": round(len(said) / dur, 1) if dur > 0 else None,  # kana-ish chars per second
        "readings": has_readings(),
    }


# ---------------------------------------------------------------- transcription

def transcribe_clip(model, audio, beam_size=5):
    """Transcribe a short 16 kHz float32 clip into words with confidences."""
    segments, _ = model.transcribe(
        audio, language="ja", word_timestamps=True, initial_prompt=jpcut.FILLER_PROMPT,
        beam_size=beam_size, vad_filter=False, condition_on_previous_text=False)
    words = []
    for seg in segments:
        # Whisper invents text for silence/noise ("ご視聴ありがとうございました")
        if seg.no_speech_prob > 0.6 and seg.avg_logprob < -0.8:
            continue
        for w in seg.words or []:
            words.append({"word": w.word, "start": round(w.start, 2), "end": round(w.end, 2),
                          "probability": round(w.probability, 3)})
    return words
