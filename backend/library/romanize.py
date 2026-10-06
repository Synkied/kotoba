"""Readings in Latin letters for Japanese, Chinese and Korean text, so "tokyo" finds 東京.

Kana and hangul are converted by rule. Kanji and hanzi need pykakasi and pypinyin;
without them those characters are skipped, and the web page says so.
"""

import re
import unicodedata

KANA = re.compile("[぀-ヿｦ-ﾟ]")
HANGUL = re.compile("[가-힣]")
HAN = re.compile("[㐀-䶿一-鿿]")

_kakasi = None
_pinyin = None


def _load() -> None:
    global _kakasi, _pinyin
    if _kakasi is None:
        try:
            import pykakasi
            _kakasi = pykakasi.kakasi()
        except ImportError:
            _kakasi = False
    if _pinyin is None:
        try:
            from pypinyin import Style, lazy_pinyin
            _pinyin = lambda text: lazy_pinyin(text, style=Style.TONE)  # nǐ hǎo, with tone marks
        except ImportError:
            _pinyin = False


def engine() -> str:
    """Names what the readings were made with; stored readings are redone when it changes."""
    _load()
    return "5" + ("+kakasi" if _kakasi else "") + ("+pinyin" if _pinyin else "")


def missing() -> list:
    """The dictionaries this Python lacks, so the page can say why kanji have no reading."""
    _load()
    return [name for name, mod in (("pykakasi", _kakasi), ("pypinyin", _pinyin)) if not mod]


# --- kana, by rule (used when pykakasi is missing) ---------------------------

_SYL = dict((tok[0], tok[1:]) for tok in """
あa いi うu えe おo かka きki くku けke こko がga ぎgi ぐgu げge ごgo さsa しshi すsu せse そso
ざza じji ずzu ぜze ぞzo たta ちchi つtsu てte とto だda ぢji づzu でde どdo なna にni ぬnu ねne のno
はha ひhi ふfu へhe ほho ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo まma みmi むmu めme もmo
やya ゆyu よyo らra りri るru れre ろro わwa ゐi ゑe をo んn ゔvu ぁa ぃi ぅu ぇe ぉo ゎwa
""".split())
_YOON = {"ゃ": "a", "ゅ": "u", "ょ": "o"}


def _kana(text: str) -> str:
    text = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in unicodedata.normalize("NFKC", text))
    out, double, i = [], False, 0
    while i < len(text):
        ch, nxt = text[i], text[i + 1:i + 2]
        i += 1
        if ch == "っ":
            double = True
            continue
        if ch == "ー":  # long vowel mark repeats the vowel before it
            if out and out[-1][-1:] in tuple("aiueo"):
                out.append(out[-1][-1])
            continue
        r = _SYL.get(ch)
        if r is None:
            out.append(ch)
            double = False
            continue
        if nxt in _YOON and len(r) > 1 and r.endswith("i"):  # きゃ kya, しゃ sha
            r = r[:-1] + _YOON[nxt] if r in ("shi", "chi", "ji") else r[:-1] + "y" + _YOON[nxt]
            i += 1
        elif nxt and nxt in "ぁぃぅぇぉ" and len(r) > 1:  # ファ fa, ティ ti
            r = r[:-1] + _SYL[nxt]
            i += 1
        if double:
            r = ("t" if r.startswith("ch") else r[0]) + r
            double = False
        out.append(r)
    return "".join(out)


# --- hangul, Revised Romanization syllable by syllable -----------------------

_INITIAL = "g kk n d tt r m b pp s ss - j jj ch k t p h".split()
_MEDIAL = "a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i".split()
_FINAL = "- k k k n n n t l k m l l l p l m p p t t ng t t k t p t".split()


def _korean(text: str) -> str:
    out = []
    for ch in text:
        n = ord(ch) - 0xAC00
        if 0 <= n < 11172:
            out.append((_INITIAL[n // 588] + _MEDIAL[n % 588 // 28] + _FINAL[n % 28]).replace("-", ""))
        else:
            out.append(ch)
    return "".join(out)


# --- putting it together -----------------------------------------------------

def _japanese(line: str) -> str:
    if _kakasi:
        return " ".join(part["hepburn"] for part in _kakasi.convert(line))
    return _kana(line)


def _chinese(line: str) -> str:
    return " ".join(_pinyin(line)) if _pinyin else ""


def _could_be_japanese(line: str) -> bool:
    """False when a character is outside the Japanese character set, as simplified
    Chinese ones like 们 or 这 are."""
    try:
        "".join(HAN.findall(line)).encode("cp932")
        return True
    except UnicodeEncodeError:
        return False


def _tidy(reading: str) -> str:
    # À-ɏ keeps accented Latin letters, so pinyin keeps its tone marks
    return " ".join(re.sub(r"[^0-9A-Za-zÀ-ɏ'\-]+", " ", unicodedata.normalize("NFKC", reading)).split()).lower()


def _plain(ch: str) -> str:
    """ǎ -> a, ü -> u: one letter without its marks, so readings match however they're typed."""
    base = "".join(c for c in unicodedata.normalize("NFD", ch) if not unicodedata.combining(c))
    return base if len(base) == 1 else ch


def romanize(text: str) -> str:
    """One reading per line in Japanese, Chinese or Korean ("" if none). A kanji-only
    line could be either language, so it gets both: "japanese<TAB>chinese"."""
    _load()
    out = []
    for line in text.splitlines():
        parts = []
        if HANGUL.search(line):
            parts.append(_tidy(_korean(line)))
        if KANA.search(line):
            parts.append(_tidy(_japanese(line)))
        elif HAN.search(line):
            ja, zh = _tidy(_japanese(line)), _tidy(_chinese(line))
            if zh and not _could_be_japanese(line):
                parts.append(zh)
            else:
                parts.append(ja + "\t" + zh if zh and zh != ja else ja)
        reading = " ".join(p for p in parts if p)
        if re.search("[a-z]", reading) and reading not in out:
            out.append(reading)
    return "\n".join(out)


# --- furigana ------------------------------------------------------------------

_KANJI_RUN = re.compile("([㐀-䶿一-鿿々〆]+)")


def _hira(text: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text)


def _split_word(orig: str, reading: str) -> list:
    """Give each kanji run of a word its share of the reading, using the kana between
    them as anchors: 取り扱い + とりあつかい -> 取 と, 扱 あつか. Falls back to the
    whole word when the kana don't line up (e.g. 今日は read こんにちは)."""
    runs = [r for r in _KANJI_RUN.split(orig) if r]
    pattern = "".join("(.+?)" if _KANJI_RUN.fullmatch(r) else re.escape(_hira(r)) for r in runs)
    m = re.fullmatch(pattern, _hira(reading))
    if not m:
        return [[orig, reading]]
    kanji = [r for r in runs if _KANJI_RUN.fullmatch(r)]
    return [[k, rd] for k, rd in zip(kanji, m.groups())]


def furigana(text: str) -> list:
    """Hiragana readings for the kanji in Japanese text, as [kanji, reading] pairs in
    the order they appear (each kanji run is found after the previous one). Empty
    without pykakasi, and for lines that can only be Chinese."""
    _load()
    if not _kakasi:
        return []
    out = []
    for line in text.split("\n"):
        if not HAN.search(line) or HANGUL.search(line) or not (KANA.search(line) or _could_be_japanese(line)):
            continue
        for part in _kakasi.convert(line):
            orig, reading = part["orig"], part["hira"]
            if _KANJI_RUN.search(orig) and reading and not HAN.search(reading):
                out.extend(_split_word(orig, reading))
    return out


def key(text: str) -> str:
    """Search key that forgives how people type readings: no spaces, punctuation or
    tone marks (nihao = nǐ hǎo), long vowels written once (toukyou = tokyo), and m/n before b/p (shimbun = shinbun).
    web.html has the same function as romanKey; keep them in step."""
    t = re.sub("[^a-z0-9]", "", "".join(map(_plain, unicodedata.normalize("NFKC", text).lower())))
    out = []
    for i, ch in enumerate(t):
        prev = out[-1] if out else ""
        if (ch == "u" and prev == "o") or (ch in "aiueo" and ch == prev):
            continue
        out.append("n" if ch == "m" and t[i + 1:i + 2] in ("b", "p") else ch)
    return "".join(out)
