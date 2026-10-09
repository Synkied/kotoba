"""Word lookup: tap a word in a sentence to see its reading and meaning.

MeCab (UniDic) cuts sentences into short units, so 図書館 arrives as 図書 + 館. A lookup
joins the units around the tapped character into the longest word JMdict knows, then
carries any endings along (読んでいました is 読む). JMdict comes from jmdict-simplified:
downloaded once into the data directory and indexed in SQLite, so lookups stay offline.
"""

import io
import json
import os
import re
import sqlite3
import threading
import urllib.request
import zipfile
from pathlib import Path

from django.conf import settings

from . import romanize

LANG = os.environ.get("KOTOBA_DICT_LANG", "eng")  # eng, fre, ger, spa, rus, … as jmdict-simplified names them
RELEASES = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
MAX_UNITS = 8        # longest run of MeCab units tried as one word
MAX_ENTRIES = 3
MAX_SENSES = 5

# endings that stay with the word before them: 読ん|で|い|まし|た, 食べ|たく|ない
_ENDING_POS = {"助動詞"}
_ENDING_WORDS = {("助詞", "て"), ("助詞", "ば"), ("動詞", "いる"), ("動詞", "居る"), ("動詞", "ある"), ("動詞", "有る"),
                 ("動詞", "しまう"), ("動詞", "仕舞う"), ("動詞", "おく"), ("動詞", "置く"), ("形容詞", "無い"), ("接尾辞", "さ")}
_INFLECTING = {"動詞", "形容詞", "助動詞"}
_SKIP = {"補助記号", "空白"}

_decoder = json.JSONDecoder()
_state = {"downloading": False, "error": None}
_lock = threading.Lock()
_local = threading.local()


def path() -> Path:
    return Path(settings.DATA_DIR) / f"jmdict-{LANG}.sqlite"


def status() -> dict:
    p = path()
    state = "ready" if p.exists() else "downloading" if _state["downloading"] else "error" if _state["error"] else "missing"
    out = {"state": state, "error": _state["error"], "lang": LANG}
    if state == "ready":
        out["version"] = dict(_db().execute("SELECT key, value FROM meta")).get("version")
    return out


# --- building the index --------------------------------------------------------

def _compact(word: dict) -> dict:
    senses = [{
        "pos": s["partOfSpeech"], "misc": s["misc"] + s["field"] + s["dialect"], "info": s["info"],
        "kanji": [k for k in s["appliesToKanji"] if k != "*"], "kana": [k for k in s["appliesToKana"] if k != "*"],
        "gloss": [g["text"] for g in s["gloss"]],
    } for s in word["sense"] if s["gloss"]]
    return {
        "kanji": [{"text": k["text"], "common": k["common"], "tags": k["tags"]} for k in word["kanji"]],
        "kana": [{"text": k["text"], "common": k["common"], "tags": k["tags"],
                  "kanji": [x for x in k["appliesToKanji"] if x != "*"]} for k in word["kana"]],
        "senses": senses,
    }


def build(source, target: Path | None = None, progress=None) -> int:
    """Index a jmdict-simplified JSON file (a path, or lines of it) into SQLite. One
    entry per line, so it streams instead of loading 120 MB of JSON at once."""
    target = target or path()
    tmp = target.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, common INTEGER, data TEXT);
        CREATE TABLE forms (form TEXT, entry INTEGER, rank INTEGER);
    """)
    lines = open(source, encoding="utf-8") if isinstance(source, (str, Path)) else source
    count, header = 0, []
    for raw in lines:
        line = raw.strip()
        if line.startswith('{"id"'):
            word = _decoder.raw_decode(line)[0]  # the last entry is followed by the closing brackets
            entry = _compact(word)
            common = any(f["common"] for f in entry["kanji"] + entry["kana"])
            db.execute("INSERT INTO entries VALUES (?, ?, ?)", (int(word["id"]), common, json.dumps(entry, ensure_ascii=False)))
            forms = {}
            for f in entry["kanji"] + entry["kana"]:
                text = romanize._hira(f["text"])  # katakana words are found from hiragana too
                rank = 0 if f["common"] else 2 if any(t in ("sK", "sk", "rK", "rk", "ik", "iK", "ok", "oK") for t in f["tags"]) else 1
                for form in {f["text"], text}:
                    forms[form] = min(rank, forms.get(form, 9))
            db.executemany("INSERT INTO forms VALUES (?, ?, ?)", [(f, int(word["id"]), r) for f, r in forms.items()])
            count += 1
            if progress and count % 20000 == 0:
                progress(count)
        elif not count:
            header.append(raw)
    if not count:
        db.close()
        tmp.unlink()
        raise ValueError("No JMdict entries found: expected jmdict-simplified JSON.")
    head = json.loads("".join(header) + "]}") if header else {}
    db.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("version", f"{head.get('version', '')} ({head.get('dictDate', '')})"),
        ("tags", json.dumps(head.get("tags", {}), ensure_ascii=False)),
    ])
    db.execute("CREATE INDEX forms_form ON forms (form)")
    db.commit()
    db.close()
    os.replace(tmp, target)
    _local.__dict__.clear()
    return count


def download(progress=None) -> int:
    """Fetch the latest jmdict-simplified release for LANG and index it."""
    with urllib.request.urlopen(RELEASES, timeout=30) as r:
        assets = json.load(r)["assets"]
    name = f"jmdict-{LANG}-"
    url = next((a["browser_download_url"] for a in assets
                if a["name"].startswith(name) and a["name"].endswith(".json.zip") and "common" not in a["name"]), None)
    if not url:
        raise ValueError(f"jmdict-simplified has no dictionary for “{LANG}”.")
    if progress:
        progress(f"Downloading {url.rsplit('/', 1)[-1]}")
    with urllib.request.urlopen(url, timeout=300) as r:
        data = io.BytesIO(r.read())
    with zipfile.ZipFile(data) as z, z.open(z.namelist()[0]) as f:
        return build(io.TextIOWrapper(f, encoding="utf-8"), progress=progress)


def ensure() -> None:
    """Start the one-time download in the background, if it isn't there yet."""
    with _lock:
        if path().exists() or _state["downloading"]:
            return
        _state.update(downloading=True, error=None)

    def run():
        try:
            download()
        except Exception as e:  # noqa: BLE001 - shown to the person on the next lookup
            _state["error"] = f"Couldn’t download the dictionary: {e}"
        finally:
            _state["downloading"] = False

    threading.Thread(target=run, daemon=True, name="jmdict").start()


# --- looking up ------------------------------------------------------------------

def _db() -> sqlite3.Connection:
    db = getattr(_local, "db", None)
    if db is None:
        db = _local.db = sqlite3.connect(f"file:{path()}?mode=ro", uri=True, check_same_thread=False)
    return db


def _known(forms: list) -> bool:
    return bool(forms) and path().exists() and _db().execute(
        f"SELECT 1 FROM forms WHERE form IN ({','.join('?' * len(forms))}) LIMIT 1", forms).fetchone() is not None


def entries(forms: list, reading: str = "") -> list:
    """JMdict entries for any of these written forms; ones read as `reading` and
    common words come first."""
    if not forms or not path().exists():
        return []
    db = _db()
    rows = db.execute(f"""SELECT e.id, e.data, MIN(f.rank), e.common FROM forms f JOIN entries e ON e.id = f.entry
                          WHERE f.form IN ({','.join('?' * len(forms))}) GROUP BY e.id""", forms).fetchall()
    hira = romanize._hira(reading)
    out = []
    for id_, data, rank, common in rows:
        entry = json.loads(data)
        reads = any(romanize._hira(k["text"]) == hira for k in entry["kana"]) if hira else False
        written = any(k["text"] in forms for k in entry["kanji"])
        out.append(((not reads, rank, not written, not common, id_), {"id": id_, **entry}))
    out.sort(key=lambda x: x[0])
    # "noun (common) (futsuumeishi)" -> "noun (common)": the Japanese grammar term adds nothing here
    tags = {k: re.sub(r" \([a-z]+\)$", "", v)
            for k, v in json.loads(dict(db.execute("SELECT key, value FROM meta")).get("tags") or "{}").items()}
    result = []
    for _, entry in out[:MAX_ENTRIES]:
        for s in entry["senses"]:
            s["pos"] = [tags.get(p, p) for p in s["pos"]]
            s["misc"] = [tags.get(m, m) for m in s["misc"]]
        entry["senses"] = entry["senses"][:MAX_SENSES]
        result.append(entry)
    return result


def _tokens(line: str) -> list:
    out, at = [], 0
    tagged = list(romanize._tagger(line))
    for n, t in enumerate(tagged):
        start = line.find(t.surface, at)
        if start < 0:
            continue
        f = t.feature
        kana = romanize.token_reading(tagged, n, line[:start])  # the reading the sentence's furigana show
        base = f.orthBase if getattr(f, "orthBase", None) and f.orthBase != "*" else t.surface
        base_kana = f.kanaBase if getattr(f, "kanaBase", None) and f.kanaBase != "*" else kana
        out.append({"surface": t.surface, "start": start, "end": start + len(t.surface), "pos": f.pos1,
                    "kana": romanize._hira(kana), "base": base, "base_kana": romanize._hira(base_kana),
                    "lemma": (f.lemma or "").split("-")[0]})
        at = start + len(t.surface)
    return out


def _forms(toks: list) -> list:
    """(written form, reading) pairs a run of units could be listed under: as written,
    then with the last unit in its dictionary form (お勧め as it is; 食べ -> 食べる)."""
    head = "".join(t["surface"] for t in toks[:-1])
    head_kana = "".join(t["kana"] for t in toks[:-1])
    last = toks[-1]
    out = [(head + last["surface"], head_kana + last["kana"])]
    if last["pos"] in _INFLECTING and last["base"] != last["surface"]:
        out.append((head + last["base"], head_kana + last["base_kana"]))
    return out


def _match(run: list) -> tuple | None:
    """The (form, reading) the dictionary lists this run under. A run holding a particle
    must also be read the dictionary's way: 今日は here is きょう + は, not こんにちは."""
    particle = any(t["pos"] == "助詞" for t in run)
    for form, reading in _forms(run):
        if not _known([form]):
            continue
        if particle and not any(romanize._hira(k["text"]) == reading for e in entries([form]) for k in e["kana"]):
            continue
        return form, reading
    return None


def _ending(t: dict) -> bool:
    return t["pos"] in _ENDING_POS or (t["pos"], t["lemma"]) in _ENDING_WORDS or (t["pos"], t["base"]) in _ENDING_WORDS


def _romaji(hira: str) -> str:
    if romanize._kakasi:
        return "".join(p["hepburn"] for p in romanize._kakasi.convert(hira))
    return romanize._kana(hira)


def _shown(text: str, pairs: list, start: int, end: int) -> list | None:
    """The [kanji, reading] pairs the sentence shows over text[start:end], when they
    cover every kanji there (and none spills past it); None otherwise."""
    inside, at = [], 0
    for surface, reading in pairs:
        s = text.find(surface, at)
        if s < 0:
            continue
        at = s + len(surface)
        if s < end and at > start:
            if s < start or at > end:
                return None
            inside.append([surface, reading])
    kanji = "".join(romanize._KANJI_RUN.findall(text[start:end]))
    return inside if inside and "".join(romanize._KANJI_RUN.findall("".join(k for k, _ in inside))) == kanji else None


def lookup(text: str, at: int, pairs: list | None = None) -> dict | None:
    """The word covering character `at` of `text`, with its reading and meanings.
    `pairs` are the furigana the sentence shows (its saved readings, say); the word's
    readings follow them, so the popover agrees with the sentence."""
    romanize._load()
    if not romanize._tagger or not 0 <= at < len(text):
        return None
    # tokenize just the line that was tapped, as the readings do
    line_start = text.rfind("\n", 0, at) + 1
    line_end = text.find("\n", at)
    line = text[line_start:line_end if line_end >= 0 else len(text)]
    at -= line_start
    toks = _tokens(line)
    i = next((n for n, t in enumerate(toks) if t["start"] <= at < t["end"]), None)
    if i is None or toks[i]["pos"] in _SKIP:
        return None

    # the longest run of units around i that the dictionary lists as one word
    a, b, match = i, i, None
    if path().exists():
        for size in range(min(MAX_UNITS, len(toks)), 0, -1):
            for start in range(max(0, i - size + 1), min(i, len(toks) - size) + 1):
                run = toks[start:start + size]
                if not any(t["pos"] in _SKIP for t in run) and (match := _match(run)):
                    a, b = start, start + size - 1
                    break
            if match:
                break
    head = toks[a:b + 1]
    lemma, lemma_reading = match or _forms(head)[-1]
    # keep conjugation with its word: 読ん + で + い + まし + た
    if head[-1]["pos"] in _INFLECTING or (b > a and head[-1]["pos"] == "接尾辞"):
        while b + 1 < len(toks) and _ending(toks[b + 1]):
            b += 1
    run = toks[a:b + 1]
    surface = line[run[0]["start"]:run[-1]["end"]]
    reading = "".join(t["kana"] for t in run)

    found = entries([lemma], lemma_reading)
    if not found and len(head) == 1 and head[0]["lemma"] and head[0]["lemma"] != lemma:
        found = entries([head[0]["lemma"]], lemma_reading)  # UniDic spells some lemmas differently

    furigana = [p for t in run if romanize._KANJI_RUN.search(t["surface"]) and not romanize.HAN.search(t["kana"])
                for p in romanize._split_word(t["surface"], t["kana"])]
    if found and lemma == surface and any(k["text"] == surface for k in found[0]["kanji"]):
        # MeCab can pick a reading the dictionary doesn't give this spelling (日本語 as にっぽんご)
        kana = [romanize._hira(k["text"]) for k in found[0]["kana"] if not k["kanji"] or surface in k["kanji"]]
        if kana and reading not in kana:
            reading = lemma_reading = kana[0]
            furigana = romanize._split_word(surface, reading)
    shown = _shown(text, pairs or [], line_start + run[0]["start"], line_start + run[-1]["end"])
    if shown:
        furigana = shown
        reading = romanize._hira(romanize.with_readings(surface, shown))
        if lemma == surface:
            lemma_reading = reading
    inflected = lemma != surface
    return {
        "surface": surface, "start": line_start + run[0]["start"], "end": line_start + run[-1]["end"],
        "reading": reading, "romaji": _romaji(reading), "furigana": furigana,
        "lemma": lemma if inflected else None,
        "lemma_reading": lemma_reading if inflected else None,
        "lemma_romaji": _romaji(lemma_reading) if inflected else None,
        "entries": found,
    }
