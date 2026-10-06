"""Turning what comes in into sentences."""
import re
import unicodedata

SENTENCE_END = "。！？!?"
_SPLIT = re.compile(r"[^\n。！？!?]+[。！？!?」』）)]*")
_SRT_TIME = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")
_ASS_LINE = re.compile(r"^Dialogue:\s*[^,]*,(\d+):(\d+):(\d+)\.(\d+),(\d+):(\d+):(\d+)\.(\d+),(?:[^,]*,){6}(.*)$")
GAP = 0.8  # seconds of silence that end a sentence in a transcript


def split_text(text: str) -> list:
    """Pasted or captured text: one sentence per line, long lines split at 。！？."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in _SPLIT.findall(line) if p.strip()]
        out.extend(parts or [line])
    return out


def _secs(h, m, s, frac):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(frac) / (10 ** len(frac))


def parse_subtitles(raw: str) -> list:
    """SRT, WebVTT or ASS/SSA into [(start, end, text)]."""
    cues = []
    if "[Events]" in raw or raw.lstrip().startswith("[Script Info]"):
        for line in raw.splitlines():
            m = _ASS_LINE.match(line.strip())
            if m:
                text = re.sub(r"\{[^}]*\}", "", m[9]).replace("\\N", " ").replace("\\n", " ").strip()
                if text:
                    cues.append((_secs(*m.groups()[0:4]), _secs(*m.groups()[4:8]), text))
        return cues
    for block in re.split(r"\n\s*\n", raw.replace("\r", "")):
        lines = block.strip().splitlines()
        for i, line in enumerate(lines):
            m = _SRT_TIME.search(line)
            if m:
                text = " ".join(re.sub(r"<[^>]+>", "", t).strip() for t in lines[i + 1:]).strip()
                if text:
                    cues.append((_secs(*m.groups()[0:4]), _secs(*m.groups()[4:8]), text))
                break
    return cues


def group_words(words: list) -> list:
    """Whisper words ({word, start, end}) into [(start, end, text)] sentences, ending at
    sentence punctuation or a pause."""
    out, cur, start, last_end = [], [], None, None
    for w in words:
        text = unicodedata.normalize("NFKC", w["word"]).strip()
        if not text:
            continue
        if cur and last_end is not None and w["start"] - last_end > GAP:
            out.append((start, last_end, "".join(cur)))
            cur, start = [], None
        if start is None:
            start = w["start"]
        cur.append(text)
        last_end = w["end"]
        if text[-1] in SENTENCE_END:
            out.append((start, last_end, "".join(cur)))
            cur, start = [], None
    if cur:
        out.append((start, last_end, "".join(cur)))
    return [(round(a, 2), round(b, 2), t) for a, b, t in out if t.strip(" 、。")]
