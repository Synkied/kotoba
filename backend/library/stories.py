"""Stories: short texts an LLM writes inside what you've studied, read aloud by kotoba's voices.

A story is asked for against a syllabus and a unit of it: the JLPT levels that come with kotoba
(N5 is unit 1, N4 unit 2, …), or one you fill in yourself, such as Minna no Nihongo lesson by
lesson. It may use the words and grammar of every unit up to that one, and features that
unit's own. The writer is one of the user's saved LLMs (translate.writer).

Writing one runs on the speech worker in steps, each kept in Source.story so a failed step is
all that runs again:

  writing   the writer answers with the story as JSON, each line with its translation
  checking  every word is matched against the allowed set; the writer rewrites the lines that
            stray, once, and what still strays is kept and marked
  voicing   each line is read by one voice, and the takes are joined into the source's media
            with each sentence's span, so it plays like a recording

The story is an ordinary Source of kind "story": its lines are sentences, with their words,
translations, readings and practice like any other. Source.job is left alone; it means
transcription everywhere else.
"""
import csv
import hashlib
import io
import json
import random
import re
import shutil
import subprocess
import tempfile
import unicodedata
import wave
from functools import lru_cache
from pathlib import Path

from django.core.files.base import ContentFile
from django.db import transaction
from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import romanize, translate, words
from .models import Lesson, Sentence, Source, Syllabus, SyllabusUnit, fold

JLPT = "jlpt"
JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"]
DATA = Path(__file__).parent / "syllabi" / "jlpt"
LENGTHS = {"short": 8, "medium": 16, "long": 30}
REGISTERS = {"polite": "Use polite です/ます forms throughout, as in a textbook.",
             "plain": "Use plain forms (だ, る, た) throughout, as friends talk or a diary reads."}
BUSY = ("queued", "writing", "checking", "voicing")
MAX_LINES = 40
PROMPT_WORDS = 700     # words of each kind (new, studied) named in the prompt; the check knows them all
GAP = 0.7              # seconds of silence between lines
WRITE_TIMEOUT = 300


class StoryError(Exception):
    pass


# --- syllabi ------------------------------------------------------------------------

def _rows(path: Path) -> list[list[str]]:
    if not path.exists():
        return []
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@lru_cache
def _jlpt_units() -> tuple:
    return tuple({"number": i, "title": level, "lesson": None,
                  "vocab": [(r + ["", ""])[:3] for r in _rows(DATA / f"n{level[1]}.tsv")],
                  "grammar": [(r + [""])[:2] for r in _rows(DATA / f"grammar-n{level[1].lower()}.tsv")]}
                 for i, level in enumerate(JLPT_LEVELS, 1))


def _unit(u: SyllabusUnit) -> dict:
    return {"number": u.number, "title": u.title, "vocab": u.vocab, "grammar": u.grammar, "lesson": u.lesson_id,
            "lesson_title": u.lesson.title if u.lesson_id else None}


def syllabus(user, sid) -> dict:
    """{id, name, bundled, units: [{number, title, vocab, grammar, lesson}]}; KeyError if it isn't theirs."""
    if str(sid) == JLPT:
        return {"id": JLPT, "name": "JLPT", "bundled": True, "units": list(_jlpt_units())}
    try:
        s = Syllabus.objects.of(user).get(pk=int(sid))
    except (ValueError, Syllabus.DoesNotExist) as e:
        raise KeyError(sid) from e
    return {"id": s.id, "name": s.name, "bundled": False,
            "units": [_unit(u) for u in s.units.select_related("lesson")]}


def summary(syl: dict) -> dict:
    """A syllabus without its word lists, for menus."""
    return {**syl, "units": [{"number": u["number"], "title": u["title"], "vocab": len(u["vocab"]),
                              "grammar": len(u["grammar"]), "lesson": u.get("lesson"),
                              "lesson_title": u.get("lesson_title")} for u in syl["units"]]}


def unit_name(syl: dict, unit: dict) -> str:
    if syl["bundled"]:
        return f"JLPT {unit['title']}"
    return f"{syl['name']}, unit {unit['number']}" + (f" ({unit['title']})" if unit["title"] else "")


# typed or pasted lists: one per line, "word reading — meaning", tabs, or "word（reading）"
_SEP = re.compile(r"\t|\s+[—–=:]\s+|\s+-\s+")
_PAREN = re.compile(r"^(.+?)[（(]([^）)]+)[）)]$")


def _kana(text: str) -> bool:
    return bool(text) and all(romanize.KANA.match(c) or c in "ー〜～・ " for c in text)


def parse_vocab(text: str) -> list[list[str]]:
    out = []
    for line in str(text).splitlines():
        line = line.strip().lstrip("-*•・").strip()
        if not line:
            continue
        cells = [c.strip() for c in line.split("\t")]
        if len(cells) >= 3:
            word, reading, meaning = cells[:3]
        else:
            head, meaning = ([*_SEP.split(line, maxsplit=1), ""])[:2]
            head, meaning = head.strip(), meaning.strip()
            m, bits = _PAREN.match(head), head.split()
            if m and _kana(m[2].strip()):
                word, reading = m[1].strip(), m[2].strip()
            elif len(bits) == 2 and _kana(bits[1]):
                word, reading = bits
            else:
                word, reading = head, ""
        if word:
            out.append([word[:100], reading[:100], meaning[:300]])
    return out


def parse_grammar(text: str) -> list[list[str]]:
    out = []
    for line in str(text).splitlines():
        line = line.strip().lstrip("-*•").strip()
        if line:
            pattern, note = (_SEP.split(line, maxsplit=1) + [""])[:2]
            out.append([pattern.strip()[:200], note.strip()[:300]])
    return out


CSV_HEAD = ["unit", "title", "type", "text", "reading", "meaning"]


def export_csv(syl: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_HEAD)
    for u in syl["units"]:
        if not u["vocab"] and not u["grammar"]:
            w.writerow([u["number"], u["title"], "", "", "", ""])
        for word, reading, meaning in u["vocab"]:
            w.writerow([u["number"], u["title"], "vocab", word, reading, meaning])
        for pattern, note in u["grammar"]:
            w.writerow([u["number"], u["title"], "grammar", pattern, "", note])
    return buf.getvalue()


def import_csv(s: Syllabus, text: str) -> int:
    """Units named in the CSV are replaced by what it lists; others stay. Returns how many units."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if rows and [c.strip().lower() for c in rows[0][:3]] == CSV_HEAD[:3]:
        rows = rows[1:]
    units: dict[int, dict] = {}
    for n, row in enumerate(rows, 2):
        row = [c.strip() for c in row] + [""] * 6
        if not any(row):
            continue
        try:
            number = int(row[0])
            if not 0 < number < 10000:
                raise ValueError
        except ValueError:
            raise ValueError(f"Line {n}: the first column should be the unit number.") from None
        u = units.setdefault(number, {"title": "", "vocab": [], "grammar": []})
        u["title"] = u["title"] or row[1][:200]
        kind = row[2].lower()
        if kind in ("vocab", "word", "words") and row[3]:
            u["vocab"].append([row[3][:100], row[4][:100], row[5][:300]])
        elif kind == "grammar" and row[3]:
            u["grammar"].append([row[3][:200], row[5][:300]])
        elif kind and kind not in ("vocab", "word", "words", "grammar"):
            raise ValueError(f"Line {n}: the type should be vocab or grammar, not {row[2]!r}.")
    with transaction.atomic():
        for number, u in units.items():
            SyllabusUnit.objects.update_or_create(syllabus=s, number=number, defaults=u)
    return len(units)


# --- what a story may use -------------------------------------------------------------

def _forms(entry) -> tuple[list[str], list[str]]:
    """The spellings and readings of a list entry: 足; 脚 / いく; ゆく, without ～ or (する)."""
    def split(text):
        text = re.sub(r"[（(][^）)]*[）)]", "", text or "")
        return [p for p in (x.strip(" 〜～") for x in re.split(r"[;；,、/／]", text)) if p]
    word, reading = entry[0], entry[1] if len(entry) > 1 else ""
    return split(word), [romanize._hira(r) for r in split(reading)]


class Allowed:
    def __init__(self):
        self.keys, self.lemmas, self.readings = set(), set(), set()
        self.kanji_keys, self.kanji_lemmas = set(), set()   # what the syllabus writes with kanji
        self.kanji_for = {}                                  # reading -> the kanji its spellings use
        self.kana_for = {}                                   # reading -> how the syllabus spells it in kana
        self.compounds = set()                               # listed words MeCab cuts in two (日本語 without JMdict)

    def add(self, entry):
        forms, readings = _forms(entry)
        for form in forms:
            written_in_kanji = bool(romanize.HAN.search(form))
            found = words.segment(form)
            if len(found) > 1:
                self.compounds.add(form)
            keys = {w["key"] for w in found} if len(found) == 1 else set()
            lemmas = {fold(form)} | ({fold(w["lemma"]) for w in found} if len(found) == 1 else set())
            self.keys |= keys
            self.lemmas |= lemmas
            self.readings |= {w["reading"] for w in found} if len(found) == 1 else set()
            if written_in_kanji:
                self.kanji_keys |= keys
                self.kanji_lemmas |= lemmas
                for r in {*readings, *(w["reading"] for w in found[:1] if len(found) == 1)}:
                    self.kanji_for.setdefault(r, set()).update(romanize.HAN.findall(form))
            else:
                self.readings.add(romanize._hira(form))
                self.kana_for.setdefault(romanize._hira(form), form)
        self.readings |= set(readings)

    def judge(self, w: dict) -> str | None:
        """None when the word may be used; "level" when it isn't studied yet; "kanji" when it
        is, but the syllabus spells it in kana."""
        lemma = fold(w["lemma"])
        if not (w["key"] in self.keys or lemma in self.lemmas or w["reading"] in self.readings or w.get("said") in self.readings):
            return "level"
        used = set(romanize.HAN.findall(w["surface"]))
        if used and w["key"] not in self.kanji_keys and lemma not in self.kanji_lemmas:
            # 友だち for a syllabus that writes 友達 is fine; 私 for one that writes わたし isn't
            if not any(used <= self.kanji_for.get(r, set()) for r in (w["reading"], w.get("said"))):
                return "kanji"
        return None


_allowed_cache: dict[str, Allowed] = {}


def allowed(units: list[dict]) -> Allowed:
    entries = [e for u in units for e in u["vocab"]]
    stamp = hashlib.sha1(json.dumps([words.engine(), entries], ensure_ascii=False).encode()).hexdigest()
    if stamp not in _allowed_cache:
        a = Allowed()
        for e in entries:
            a.add(e)
        if len(_allowed_cache) > 8:
            _allowed_cache.pop(next(iter(_allowed_cache)))
        _allowed_cache[stamp] = a
    return _allowed_cache[stamp]


def check(lines: list[str], allow: Allowed) -> list[dict]:
    """The words of each line the syllabus doesn't allow: [{line, start, end, surface, lemma, reading, reason}].
    Names of people and places are always allowed; a word is also known by its reading as said
    there (私 is わたし, though UniDic files it under わたくし)."""
    from . import dictionary
    out = []
    for i, line in enumerate(lines):
        toks = dictionary._tokens(line)
        names = [(t["start"], t["end"]) for t in toks if t.get("pos2") == "固有名詞"]
        # a listed word that's cut into pieces covers its pieces where it stands
        names += [(m.start(), m.end()) for form in allow.compounds if form in line for m in re.finditer(re.escape(form), line)]
        for w in words.segment(line):
            if any(a < w["end"] and w["start"] < b for a, b in names):
                continue
            said = "".join(t["kana"] for t in toks if w["start"] <= t["start"] and t["end"] <= w["end"])
            reason = allow.judge({**w, "said": said})
            if reason:
                out.append({"line": i, "start": w["start"], "end": w["end"], "surface": w["surface"],
                            "lemma": w["lemma"], "reading": w["reading"], "reason": reason,
                            **({"kana": allow.kana_for.get(w["reading"], w["reading"])} if reason == "kanji" else {})})
    return out


# --- asking the writer -----------------------------------------------------------------

SYSTEM = ("You write graded stories for someone learning Japanese: natural, simple Japanese that uses only "
          "the words and grammar they have studied, each line translated for them. You reply with JSON only.")


def _sample(items: list, n: int, seed: int) -> list:
    return items if len(items) <= n else random.Random(seed).sample(items, n)


def _word_list(entries: list) -> str:
    return "、".join(dict.fromkeys(e[0] for e in entries if e[0]))


def _grammar_list(entries: list) -> str:
    return "\n".join(f"- {p}" + (f": {note}" if note else "") for p, note in entries) or "- (none listed)"


def _scope(syl: dict, number: int, seed: int) -> dict:
    units = [u for u in syl["units"] if u["number"] <= number]
    target = next(u for u in units if u["number"] == number)
    before = [u for u in units if u["number"] < number]
    return {"units": units, "target": target, "name": unit_name(syl, target),
            "new_words": _sample(target["vocab"], PROMPT_WORDS, seed),
            "old_words": _sample([e for u in before for e in u["vocab"]], PROMPT_WORDS, seed + 1),
            "new_grammar": target["grammar"], "old_grammar": [g for u in before for g in u["grammar"]]}


def _words_rules(scope: dict) -> str:
    return ("Use only the words listed below, plus particles, numbers with their counters, and people's and places' names. "
            "Spell every word exactly as it is listed: a word listed in kana is written in kana, not in kanji. "
            "Verbs and adjectives may take any form the allowed grammar gives them.\n"
            f"New words ({scope['name']}): {_word_list(scope['new_words']) or '(none listed)'}\n"
            + (f"Words studied before: {_word_list(scope['old_words'])}\n" if scope["old_words"] else ""))


def write_prompt(syl: dict, number: int, req: dict, lang: str, seed: int) -> tuple[str, str]:
    scope = _scope(syl, number, seed)
    n = LENGTHS[req["length"]]
    feature = max(3, min(len(scope["target"]["vocab"]), n // 2 + 2))
    name = translate.LANGUAGES[lang]
    level = (f"at the JLPT {scope['target']['title']} level" if syl["bundled"]
             else f"who has studied {syl['name']} up to unit {number}")
    if scope["new_grammar"] or scope["old_grammar"]:
        grammar = ("Use only these grammar patterns (and the basic sentence structure they rely on). "
                   f"Use at least {min(2, len(scope['new_grammar'])) or 'none'} of the new ones.\n"
                   f"New grammar ({scope['name']}):\n{_grammar_list(scope['new_grammar'])}\n"
                   + (f"Grammar studied before:\n{_grammar_list(scope['old_grammar'])}\n" if scope["old_grammar"] else ""))
    else:
        grammar = f"Keep the grammar to what {scope['name']} covers.\n"
    parts = [
        f"Write a short story in Japanese, {n} lines long, one sentence per line, for a learner {level}.",
        f"Theme: {req['theme']}" if req["theme"] else "Pick an everyday theme that suits these words.",
        REGISTERS.get(req["register"], "Use polite です/ます forms unless the story calls for plain speech."),
        "Give it a beginning and an end. Keep the sentences short and clear.",
        f"Feature the new words: use at least {feature} of them.",
        "", _words_rules(scope), grammar,
        "Reply with this JSON and nothing else:",
        json.dumps({"title": "a short Japanese title", "title_tr": f"the title in {name}",
                    "lines": [{"ja": "one Japanese sentence", "tr": f"its {name} translation"}],
                    "grammar": [{"pattern": "a pattern from the lists", "lines": [1, 2]}]}, ensure_ascii=False),
        "In grammar, list each pattern you used and the lines (counted from 1) it is on.",
    ]
    return SYSTEM, "\n".join(parts)


def repair_prompt(syl: dict, number: int, lines: list[dict], problems: list[dict], lang: str, seed: int) -> tuple[str, str]:
    scope = _scope(syl, number, seed)
    by_line: dict[int, list[str]] = {}
    for p in problems:
        by_line.setdefault(p["line"], []).append(
            f"{p['surface']} (write it in kana: {p['kana']})" if p["reason"] == "kanji" else p["surface"])
    name = translate.LANGUAGES[lang]
    parts = [
        f"This story for a learner of Japanese (up to {scope['name']}) uses words they haven't studied. "
        "Rewrite only the lines named below, keeping the story's meaning, so that they use only allowed words.",
        "", "The story:", *[f"{i + 1}. {line['ja']}" for i, line in enumerate(lines)],
        "", "To fix:", *[f"line {i + 1}: {'、'.join(dict.fromkeys(ws))}" for i, ws in sorted(by_line.items())],
        "", _words_rules(scope),
        "Reply with this JSON and nothing else, one entry per rewritten line:",
        json.dumps({"lines": [{"n": 3, "ja": "the new Japanese sentence", "tr": f"its {name} translation"}]}, ensure_ascii=False),
    ]
    return SYSTEM, "\n".join(parts)


def _json(reply: str) -> dict:
    text = translate._THINK.sub("", reply).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    a, b = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[a:b + 1]) if a >= 0 < b else None
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        raise StoryError("The writer didn't answer with the story kotoba asked for. Try again, or choose another model.")
    return data


def _line(item) -> dict | None:
    if not isinstance(item, dict) or not isinstance(item.get("ja"), str):
        return None
    ja = " ".join(unicodedata.normalize("NFC", item["ja"]).split())[:200]
    tr = " ".join(str(item.get("tr") or "").split())[:500]
    return {"ja": ja, "tr": tr} if ja else None


def parse_story(reply: str) -> dict:
    data = _json(reply)
    lines = [x for x in map(_line, data.get("lines") or []) if x][:MAX_LINES]
    if not lines:
        raise StoryError("The writer's answer had no lines in it. Try again, or choose another model.")
    grammar = []
    for g in data.get("grammar") or []:
        if isinstance(g, dict) and isinstance(g.get("pattern"), str) and g["pattern"].strip():
            at = sorted({n for n in g.get("lines") or [] if isinstance(n, int) and 1 <= n <= len(lines)})
            grammar.append({"pattern": g["pattern"].strip()[:200], "lines": at})
    return {"title": str(data.get("title") or "").strip()[:200], "title_tr": str(data.get("title_tr") or "").strip()[:200],
            "lines": lines, "grammar": grammar[:30]}


def apply_repair(lines: list[dict], reply: str) -> int:
    """Swap in the rewritten lines; how many there were."""
    done = 0
    for item in _json(reply).get("lines") or []:
        new = _line(item)
        n = item.get("n") if isinstance(item, dict) else None
        if new and isinstance(n, int) and 1 <= n <= len(lines):
            lines[n - 1] = new
            done += 1
    return done


# --- the steps ------------------------------------------------------------------------------

def _set(source: Source, **changes):
    source.story = {**source.story, **changes}
    Source.objects.filter(pk=source.pk).update(story=source.story)


def default_voice(status: dict | None = None) -> str | None:
    """VOICEVOX's first voice when it runs (it has many), else Kokoro's, else none."""
    from speech import engine
    status = status or engine.tts_status()
    vv = next((v["id"] for v in status["voices"] if v["engine"] == "voicevox"), None)
    return vv or next((v["id"] for v in status["voices"] if v["engine"] == "kokoro"), None)


def _write(source: Source, job=None):
    st = source.story
    syl = syllabus(source.owner, st["syllabus"])
    cfg = translate.writer(source.owner)
    _set(source, writer=cfg["name"], cloud=translate.public(cfg)["cloud"])
    reply = translate._ask(cfg, *write_prompt(syl, st["unit"], st, st["lang"], source.pk),
                           max_tokens=8000, effort="medium", temperature=0.8, timeout=WRITE_TIMEOUT)
    story = parse_story(reply)
    if job:
        job.write(f"written: {len(story['lines'])} lines")
    _set(source, **story, checked=False)


def _check(source: Source, job=None):
    """Check the words, have the writer fix the lines that stray (once), then make the sentences."""
    st = source.story
    syl = syllabus(source.owner, st["syllabus"])
    units = [u for u in syl["units"] if u["number"] <= st["unit"]]
    lines = [dict(x) for x in st["lines"]]
    romanize._load()
    can_check = romanize._tagger is not None and any(u["vocab"] for u in units)
    problems, repaired = [], 0
    if can_check:
        allow = allowed(units)
        problems = check([x["ja"] for x in lines], allow)
        if problems:
            if job:
                job.write(f"{len(problems)} words outside the syllabus; asking the writer to fix them")
            cfg = translate.writer(source.owner)
            try:
                reply = translate._ask(cfg, *repair_prompt(syl, st["unit"], lines, problems, st["lang"], source.pk),
                                       max_tokens=4000, effort="medium", timeout=WRITE_TIMEOUT)
                repaired = apply_repair(lines, reply)
            except (translate.TranslateError, StoryError) as e:
                if job:
                    job.write(f"the fix didn't come back ({e}); keeping the story as written")
            problems = check([x["ja"] for x in lines], allow)
    with transaction.atomic():
        source.sentences.all().delete()
        made = []
        for i, line in enumerate(lines):
            s = Sentence(source=source, position=i, text=line["ja"], translations={st["lang"]: line["tr"]} if line["tr"] else {})
            s.save()
            made.append(s)
        source.title = st.get("title") or source.title
        source.text = "\n".join(x["ja"] for x in lines)
        source.save(update_fields=["title", "text"])
    outside = [{**{k: v for k, v in p.items() if k != "line"}, "sentence": made[p["line"]].pk} for p in problems]
    _set(source, lines=lines, outside=outside, repaired=repaired, checked=can_check)
    words.kick()


def _join(takes: list[bytes]) -> tuple[bytes, list[tuple[float, float]]]:
    """One WAV from the takes, a pause between them, and each take's [start, end)."""
    params, frames, spans, t = None, [], [], 0.0
    for take in takes:
        with wave.open(io.BytesIO(take)) as w:
            p = (w.getnchannels(), w.getsampwidth(), w.getframerate())
            data = w.readframes(w.getnframes())
        if params is None:
            params = p
            frames.append(b"\0" * int(p[2] * 0.3) * p[0] * p[1])
            t = 0.3
        elif p != params:
            raise StoryError("The voice changed its audio format between lines.")
        length = len(data) / (p[0] * p[1] * p[2])
        spans.append((round(t, 2), round(t + length, 2)))
        frames += [data, b"\0" * int(p[2] * GAP) * p[0] * p[1]]
        t += length + GAP
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(params[0])
        w.setsampwidth(params[1])
        w.setframerate(params[2])
        w.writeframes(b"".join(frames))
    return buf.getvalue(), spans


def _compress(wav: bytes) -> tuple[bytes, str]:
    """AAC in .m4a when ffmpeg is there (a tenth of the size), else the WAV as it is. Through files:
    an MP4's index is written at the end, which a pipe can't seek back to."""
    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "in.wav", Path(tmp) / "out.m4a"
            src.write_bytes(wav)
            try:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:a", "aac", "-b:a", "64k", str(dst)],
                               capture_output=True, timeout=120, check=True)
                if dst.stat().st_size:
                    return dst.read_bytes(), ".m4a"
            except (subprocess.SubprocessError, OSError):
                pass
    return wav, ".wav"


def _voice(source: Source, job=None):
    from speech import engine
    voice = source.story.get("voice") or default_voice()
    if not voice:
        raise StoryError("No voice to read the story with: start VOICEVOX, or install kotoba's voice extra (Kokoro). "
                         "The text is ready meanwhile.")
    _set(source, voice=voice)
    sentences = list(source.sentences.order_by("position"))
    takes = []
    for i, s in enumerate(sentences, 1):
        try:
            takes.append(engine.tts(s.text, voice, 1.0, s.furigana))
        except (RuntimeError, ValueError) as e:
            raise StoryError(f"The voice couldn't read line {i}: {e}") from e
        if job:
            job.write(f"voiced line {i} of {len(sentences)}")
    audio, spans = _join(takes)
    data, ext = _compress(audio)
    if source.media:
        source.media.delete(save=False)
    source.media.save(f"story-{source.pk}{ext}", ContentFile(data), save=False)
    source.duration = spans[-1][1] + GAP if spans else None
    source.save(update_fields=["media", "duration"])
    for s, (a, b) in zip(sentences, spans):
        s.start, s.end = a, b
    Sentence.objects.bulk_update(sentences, ["start", "end"])


def run(job, pk: int):
    """Write, check and voice a story, starting from the first step not yet done."""
    source = Source.objects.select_related("owner").get(pk=pk)
    step = "writing"
    try:
        if not source.story.get("lines"):
            _set(source, state=step, error="")
            _write(source, job)
        if not source.sentences.exists():
            step = "checking"
            _set(source, state=step, error="")
            _check(source, job)
        if not source.media:
            step = "voicing"
            _set(source, state=step, error="")
            _voice(source, job)
        _set(source, state="done", error="", failed_at=None)
    except Exception as e:
        _set(source, state="failed", failed_at=step, error=str(e) or type(e).__name__)
        raise
    return {"sentences": source.sentences.count()}


def submit(source: Source):
    from speech import jobs
    _set(source, state="queued", error="")
    jobs.submit("story", source, lambda j, pk=source.pk: run(j, pk))


def public(source: Source) -> dict:
    """The story as the page shows it; one left half-done by a restart reads as failed."""
    st = source.story
    if st.get("state") in BUSY:
        from speech import jobs
        j = jobs.for_source(source.pk)
        if not j or j["kind"] != "story" or j["state"] in ("done", "error"):
            _set(source, state="failed", failed_at=st.get("state"), error="kotoba stopped before this story was finished.")
            st = source.story
    return st


# --- the API ----------------------------------------------------------------------------

def _request(data, user) -> dict:
    sid = str(data.get("syllabus") or "")
    try:
        syl = syllabus(user, sid)
    except KeyError:
        raise ValueError("Choose a syllabus.") from None
    try:
        number = int(data.get("unit"))
    except (TypeError, ValueError):
        raise ValueError("Choose a unit.") from None
    unit = next((u for u in syl["units"] if u["number"] == number), None)
    if not unit:
        raise ValueError("That unit isn't in the syllabus.")
    if not any(u["vocab"] for u in syl["units"] if u["number"] <= number):
        raise ValueError("Those units have no words yet: add the words you've studied first.")
    length = data.get("length") or "short"
    register = data.get("register") or ""
    if length not in LENGTHS or (register and register not in REGISTERS):
        raise ValueError("Choose a length and a register from the lists.")
    voice = str(data.get("voice") or "")[:60]
    return {"syllabus": syl["id"], "syllabus_name": syl["name"], "unit": number, "unit_name": unit_name(syl, unit),
            "length": length, "register": register, "theme": " ".join(str(data.get("theme") or "").split())[:200],
            "voice": voice, "lang": translate.language(user)}


def _row(s: Source) -> dict:
    st = public(s)
    return {"id": s.id, "title": s.title, "created_at": s.created_at, "status": s.status, "duration": s.duration,
            "sentences": len(s.sentences.all()), "story": {k: st.get(k) for k in (
                "syllabus", "syllabus_name", "unit", "unit_name", "length", "register", "theme", "state", "error",
                "failed_at", "title_tr", "writer", "cloud")} | {"outside": len(st.get("outside") or [])}}


@api_view(["GET", "POST"])
def stories(request):
    """GET: your stories, newest first. POST {syllabus, unit, length, register?, theme?, voice?}: write one."""
    user = request.user
    if request.method == "POST":
        try:
            req = _request(request.data, user)
            translate.writer(user)
        except (ValueError, translate.TranslateError) as e:
            return Response({"error": str(e)}, status=400)
        source = Source.objects.create(owner=user, kind=Source.Kind.STORY, status=Source.Status.KEPT,
                                       title=req["unit_name"], story=req)
        submit(source)
        return Response(_row(source), status=201)
    qs = Source.objects.of(user).filter(kind=Source.Kind.STORY).exclude(status=Source.Status.ARCHIVED).prefetch_related("sentences")
    return Response([_row(s) for s in qs])


@api_view(["POST"])
def retry(request, pk):
    """Run the story's failed step again (and the ones after it)."""
    source = Source.objects.of(request.user).filter(pk=pk, kind=Source.Kind.STORY).first()
    if not source:
        return Response({"error": "That story is gone."}, status=404)
    if public(source).get("state") in BUSY:
        return Response(_row(source))
    try:
        translate.writer(request.user)
    except translate.TranslateError as e:
        return Response({"error": str(e)}, status=400)
    submit(source)
    return Response(_row(source))


@api_view(["GET"])
def options(request):
    """What the New story form offers: syllabi, the writer, the voices, the lengths."""
    from speech import engine
    user = request.user
    own = [summary(syllabus(user, s.id)) for s in Syllabus.objects.of(user)]
    try:
        cfg = translate.writer(user)
        writer = {"id": cfg["id"], "name": cfg["name"], "cloud": translate.public(cfg)["cloud"],
                  "model": cfg["model"] or ("" if cfg["kind"] != "anthropic" else translate.CLAUDE_MODEL)}
    except translate.TranslateError:
        writer = None
    tts = engine.tts_status()
    return Response({"syllabi": [summary(syllabus(user, JLPT)), *own], "writer": writer,
                     "voices": tts["voices"], "voice": default_voice(tts),
                     "lengths": LENGTHS, "registers": list(REGISTERS),
                     "lang": translate.LANGUAGES[translate.language(user)]})


@api_view(["GET", "POST"])
def syllabi(request):
    """GET: the syllabi, without word lists. POST {name}: start one."""
    user = request.user
    if request.method == "POST":
        name = " ".join(str(request.data.get("name") or "").split())[:200]
        if not name:
            return Response({"error": "Give the syllabus a name."}, status=400)
        s = Syllabus.objects.create(owner=user, name=name)
        return Response(summary(syllabus(user, s.id)), status=201)
    return Response([summary(syllabus(user, JLPT)), *(summary(syllabus(user, s.id)) for s in Syllabus.objects.of(user))])


def _own(user, sid) -> Syllabus | None:
    return Syllabus.objects.of(user).filter(pk=sid).first() if str(sid).isdigit() else None


@api_view(["GET", "PATCH", "DELETE"])
def syllabus_detail(request, sid):
    user = request.user
    if request.method == "GET":
        try:
            return Response(summary(syllabus(user, sid)))
        except KeyError:
            return Response({"error": "That syllabus is gone."}, status=404)
    s = _own(user, sid)
    if not s:
        return Response({"error": "kotoba's own syllabi can't be changed." if sid == JLPT else "That syllabus is gone."}, status=404)
    if request.method == "DELETE":
        s.delete()
        return Response(status=204)
    name = " ".join(str(request.data.get("name") or "").split())[:200]
    if not name:
        return Response({"error": "Give the syllabus a name."}, status=400)
    s.name = name
    s.save(update_fields=["name"])
    return Response(summary(syllabus(user, s.id)))


@api_view(["GET", "PUT", "DELETE"])
def unit_detail(request, sid, number):
    """GET: a unit with its lists. PUT {title?, vocab?, grammar?, lesson?}: save it; the lists may be
    pasted text (one per line) or [[word, reading, meaning]] / [[pattern, note]]."""
    user = request.user
    if request.method == "GET":
        try:
            syl = syllabus(user, sid)
        except KeyError:
            return Response({"error": "That syllabus is gone."}, status=404)
        unit = next((u for u in syl["units"] if u["number"] == number), None)
        return Response(unit) if unit else Response({"error": "No such unit."}, status=404)
    s = _own(user, sid)
    if not s:
        return Response({"error": "That syllabus can't be changed."}, status=404)
    if request.method == "DELETE":
        SyllabusUnit.objects.filter(syllabus=s, number=number).delete()
        return Response(status=204)
    if not 0 < number < 10000:
        return Response({"error": "Number units from 1."}, status=400)
    d = request.data
    unit, _ = SyllabusUnit.objects.get_or_create(syllabus=s, number=number)
    if "title" in d:
        unit.title = " ".join(str(d["title"] or "").split())[:200]
    for field, parse, size in (("vocab", parse_vocab, 3), ("grammar", parse_grammar, 2)):
        if field in d:
            value = d[field]
            if isinstance(value, list):
                value = [[str(c)[:300] for c in (list(row) + [""] * size)[:size]] for row in value if isinstance(row, (list, tuple)) and row and row[0]]
            else:
                value = parse(value or "")
            setattr(unit, field, value)
    if "lesson" in d:
        lesson = d["lesson"]
        unit.lesson = Lesson.objects.of(user).filter(pk=lesson).first() if lesson else None
        if lesson and not unit.lesson:
            return Response({"error": "That lesson is gone."}, status=400)
    unit.save()
    return Response(_unit(unit))


@api_view(["GET", "POST"])
def syllabus_csv(request, sid):
    """GET: the syllabus as CSV (unit, title, type, text, reading, meaning). POST {csv}: replace the units it lists."""
    user = request.user
    if request.method == "GET":
        try:
            syl = syllabus(user, sid)
        except KeyError:
            return Response({"error": "That syllabus is gone."}, status=404)
        resp = HttpResponse("﻿" + export_csv(syl), content_type="text/csv; charset=utf-8")
        name = re.sub(r"[^\w.-]+", "-", syl["name"]).strip("-") or "syllabus"
        resp["Content-Disposition"] = f'attachment; filename="{name}.csv"'
        return resp
    s = _own(user, sid)
    if not s:
        return Response({"error": "That syllabus can't be changed."}, status=404)
    try:
        n = import_csv(s, str(request.data.get("csv") or ""))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    return Response({**summary(syllabus(user, s.id)), "imported": n})
