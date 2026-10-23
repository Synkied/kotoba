"""The word index: every sentence cut into the words the dictionary lists, so sentences that
share a word find each other across sources.

MeCab's short units are joined into the longest word JMdict knows (図書 + 館 is 図書館) and
endings go with their word (読んでいました is 読む), as a tapped word's lookup does. Without the
dictionary, a noun keeps its prefixes and suffixes (お母さん, 日本人) and a word is filed under
its UniDic dictionary form. Particles, auxiliaries, punctuation and numbers aren't words here.

Sentences are read in a background thread (kick()), so saving one never waits for it; a
sentence whose text changes is read again, and everything is when the engine changes (the
reading engine, or the dictionary arriving).

Each user has their own words, made from their own sentences: what one knows, another may not.
"""

import math
import threading
from collections import defaultdict

from django.db import close_old_connections, transaction
from django.db.models import Count, Exists, OuterRef, Q

from . import dictionary, romanize, srs
from .models import Attempt, Sentence, Source, Word, WordUse

VERSION = "1"
BATCH = 100
CONTENT = {"名詞", "代名詞", "動詞", "形容詞", "形状詞", "副詞", "連体詞", "感動詞"}
_FUNCTION = {"助詞", "助動詞", "補助記号", "記号", "空白"}
_NOT_WORDS = {"補助記号", "記号", "空白"}

_lock = threading.Lock()
_thread = None


def engine() -> str:
    """Names what words were found with; sentences read with another engine are read again."""
    out = f"w{VERSION}+{romanize.engine()}"
    status = dictionary.status()
    if status["state"] == "ready":
        out += f"+jmdict:{status['lang']}:{status.get('version') or ''}"
    return out[:80]


# --- cutting a sentence into words --------------------------------------------------

def _wordlike(tok: dict) -> bool:
    return bool(romanize.KANA.search(tok["surface"]) or romanize.HAN.search(tok["surface"]))


def _numeral(tok: dict) -> bool:
    return tok["pos"] == "名詞" and tok.get("pos2") == "数詞"


def _number(tok: dict) -> bool:
    return _numeral(tok) or tok["surface"].isdigit()


def _endings(toks: list, b: int) -> int:
    """Carry conjugation along: the last unit of 読ん|で|い|まし|た."""
    while b + 1 < len(toks) and dictionary._ending(toks[b + 1]):
        b += 1
    return b


def _listed(toks: list, i: int):
    """The longest run of units from i that JMdict lists as one word: (size, form, reading)."""
    if toks[i]["pos"] in _FUNCTION:
        return None
    for size in range(min(dictionary.MAX_UNITS, len(toks) - i), 0, -1):
        run = toks[i:i + size]
        if any(t["pos"] in _NOT_WORDS for t in run):
            continue
        # a run holding a particle is a phrase (これは, 写真を撮る), not one word
        if size > 1 and any(t["pos"] in ("助詞", "助動詞") for t in run):
            continue
        if size == 1 and run[0]["pos"] not in CONTENT and run[0]["pos"] not in ("接頭辞", "接尾辞"):
            return None
        match = dictionary._match(run)
        if match:
            return size, *match
    return None


def _inflects(tok: dict) -> bool:
    # verb- and adjective-like suffixes conjugate (がる, っぽい); 人 or さん don't take です along
    return tok["pos"] in dictionary._INFLECTING or (tok["pos"] == "接尾辞" and tok.get("pos2") in ("動詞的", "形容詞的"))


def segment(text: str) -> list:
    """The words of `text`: [{lemma, reading, entry, key, start, end, surface}] in order."""
    romanize._load()
    if not romanize._tagger:
        return []
    listed = dictionary.path().exists()
    out, base = [], 0
    for line in text.split("\n"):
        toks = dictionary._tokens(line)
        i = 0
        while i < len(toks):
            tok = toks[i]
            if i and _number(toks[i - 1]) and tok["pos"] in ("名詞", "接尾辞"):
                i += 1  # a counter: the 年 of 2026年
                continue
            found = _listed(toks, i) if listed else None
            if found:
                size, form, reading = found
                run = toks[i:i + size]
                if not any(t["pos"] in CONTENT for t in run) or not any(_wordlike(t) for t in run):
                    i += size  # お, さん on their own
                    continue
                head = dictionary.headword(form, reading)
                lemma, reading, entry = (head["text"], head["reading"], head["id"]) if head else (form, reading, None)
            else:
                # a noun with its prefixes and suffixes; any other content word on its own
                j = i
                while j < len(toks) and toks[j]["pos"] == "接頭辞":
                    j += 1
                if j >= len(toks) or toks[j]["pos"] not in CONTENT or _numeral(toks[j]) or not _wordlike(toks[j]):
                    i += 1
                    continue
                e = j
                if toks[j]["pos"] == "名詞":
                    while e + 1 < len(toks) and toks[e + 1]["pos"] == "接尾辞":
                        e += 1
                size = e - i + 1
                run = toks[i:e + 1]
                lemma = "".join(t["surface"] for t in run[:-1]) + run[-1]["base"]
                reading = "".join(t["kana"] for t in run[:-1]) + run[-1]["base_kana"]
                entry = None
            b = i + size - 1
            if _inflects(run[-1]):
                b = _endings(toks, b)
            start, end = toks[i]["start"], toks[b]["end"]
            key = f"j:{entry}" if entry else f"m:{lemma}/{romanize._hira(reading)}"
            out.append({"lemma": lemma[:100], "reading": romanize._hira(reading)[:100], "entry": entry, "key": key[:120],
                        "start": base + start, "end": base + end, "surface": line[start:end][:100]})
            i = b + 1
        base += len(line) + 1
    return out


# --- keeping the index -------------------------------------------------------------

def index(sentence: Sentence, stamp: str | None = None) -> None:
    """Read one sentence's words into its owner's index."""
    found = segment(sentence.text)
    stamp = stamp or engine()
    owner = Source.objects.filter(pk=sentence.source_id).values_list("owner", flat=True).first()
    with transaction.atomic():
        known = {w.key: w for w in Word.objects.filter(owner=owner, key__in={f["key"] for f in found})}
        for f in found:
            if f["key"] not in known:
                known[f["key"]] = Word.objects.create(owner_id=owner, key=f["key"], lemma=f["lemma"], reading=f["reading"],
                                                      entry=f["entry"])
        WordUse.objects.filter(sentence=sentence).delete()
        WordUse.objects.bulk_create([WordUse(word=known[f["key"]], sentence=sentence, start=f["start"], end=f["end"],
                                             surface=f["surface"]) for f in found])
        # unless its text changed meanwhile, in which case it's read again
        Sentence.objects.filter(pk=sentence.pk, text=sentence.text).update(words_engine=stamp)


def pending(user) -> int:
    return Sentence.objects.of(user).exclude(words_engine=engine()).count()


def index_pending(limit: int | None = None) -> int:
    """Read the sentences the index hasn't (or read with another engine). Returns how many."""
    stamp = engine()
    done = 0
    while limit is None or done < limit:
        batch = list(Sentence.objects.exclude(words_engine=stamp).order_by("id")[:BATCH if limit is None else min(BATCH, limit - done)])
        if not batch:
            break
        for s in batch:
            index(s, stamp)
        done += len(batch)
    if done:
        tidy()
    return done


def tidy() -> None:
    """Words no sentence uses any more go, unless you marked them known."""
    Word.objects.filter(known_at__isnull=True).exclude(Exists(WordUse.objects.filter(word=OuterRef("pk")))).delete()


def kick() -> None:
    """Start reading waiting sentences in the background, if there are any. Cheap to call often."""
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return
        if not Sentence.objects.exclude(words_engine=engine()).exists():
            return

        def run():
            close_old_connections()
            try:
                index_pending()
            finally:
                close_old_connections()

        _thread = threading.Thread(target=run, daemon=True, name="words")
        _thread.start()


# --- what the index tells -----------------------------------------------------------

def live_uses(user=None):
    """Where words stand in sentences that aren't archived: a user's, or everyone's."""
    uses = WordUse.objects.of(user) if user is not None else WordUse.objects.all()
    return uses.exclude(sentence__source__status=Source.Status.ARCHIVED)


def with_counts(qs):
    """Words with how often they appear in sentences you keep, and whether you've said one right."""
    live = Q(uses__sentence__source__status__in=[Source.Status.INBOX, Source.Status.KEPT])
    passed = live_uses().filter(word=OuterRef("pk"), sentence__last__gte=srs.PASS)
    return qs.annotate(
        sentences=Count("uses__sentence", filter=live, distinct=True),
        sources=Count("uses__sentence__source", filter=live, distinct=True),
        passed=Exists(passed),
    )


def status(word) -> str:
    """known (you said so), practised (you've said a sentence with it well), or new."""
    if word.known_at:
        return "known"
    return "practised" if getattr(word, "passed", False) else "new"


def _unit_spans(units: list, text: str) -> list:
    """[(start, end, ok)] of a scored attempt's units over the sentence text."""
    out, at = [], 0
    for u in units:
        t = u.get("text") or ""
        if not t:
            continue
        i = text.find(t, at)
        if i < 0:
            continue
        out.append((i, i + len(t), u.get("status") == "ok"))
        at = i + len(t)
    return out


RECENT = 8  # how many of a word's latest checks count


def checks(user, word_ids=None) -> dict:
    """How each of the user's words went when they said it: {word id: [ok, …]} over its latest
    scored attempts, newest first. A word counts as missed when any part of it was missed or unclear."""
    attempts = Attempt.objects.of(user).exclude(units=[]).select_related("sentence").order_by("-created_at")
    if word_ids is not None:
        attempts = attempts.filter(sentence__word_uses__word__in=word_ids).distinct()
    uses = defaultdict(list)
    q = WordUse.objects.of(user) if word_ids is None else WordUse.objects.of(user).filter(word__in=word_ids)
    for u in q.values("sentence_id", "word_id", "start", "end"):
        uses[u["sentence_id"]].append(u)
    out = defaultdict(list)
    for a in attempts.iterator(chunk_size=500):
        spans = _unit_spans(a.units, a.sentence.text)
        if not spans:
            continue
        for u in uses.get(a.sentence_id, ()):
            if len(out[u["word_id"]]) >= RECENT:
                continue
            over = [ok for s, e, ok in spans if s < u["end"] and e > u["start"]]
            if over:
                out[u["word_id"]].append(all(over))
    return out


def troubled(results: list) -> bool:
    """Missed at least twice, and in at least a third of its recent tries."""
    misses = results.count(False)
    return misses >= 2 and misses / len(results) >= 1 / 3


def related(sentence: Sentence, limit: int = 6) -> list:
    """Other sentences that share this one's less common words, the rarest shares first:
    [(sentence, [word, …])]. Words in a large share of all sentences (する, 私) don't count."""
    mine = {u.word_id: u.word for u in sentence.word_uses.select_related("word")}
    if not mine:
        return []
    # its words are its owner's, so the sentences sharing them are too
    total = max(1, Sentence.objects.filter(source__owner=sentence.source.owner_id)
                .exclude(source__status=Source.Status.ARCHIVED).count())
    df = dict(live_uses().filter(word__in=mine).values("word").annotate(n=Count("sentence", distinct=True))
              .values_list("word", "n"))
    cap = max(3, total * 0.05)
    weight = {w: 1 / math.log(1 + n) for w, n in df.items() if 1 < n <= cap}
    if not weight:
        return []
    shared = defaultdict(set)
    for sid, wid in (live_uses().filter(word__in=weight).exclude(sentence=sentence)
                     .values_list("sentence_id", "word_id")):
        shared[sid].add(wid)
    near = set(Sentence.objects.filter(source=sentence.source_id, position__gte=sentence.position - 1,
                                       position__lte=sentence.position + 1).values_list("id", flat=True))
    ranked = sorted((sid for sid in shared if sid not in near),
                    key=lambda sid: (-sum(weight[w] for w in shared[sid]), sid))[:limit]
    found = Sentence.objects.select_related("source").prefetch_related("attempts", "decks").in_bulk(ranked)
    return [(found[sid], sorted((mine[w] for w in shared[sid]), key=lambda w: -weight[w.id])) for sid in ranked if sid in found]


def next_sentences(user, limit: int = 20) -> list:
    """Sentences you're one word away from: every other word in them is known or practised.
    The new word that's in the most of your sentences comes first. [(sentence, word, its sentences)]"""
    passed = live_uses().filter(word=OuterRef("pk"), sentence__last__gte=srs.PASS)
    familiar = set(Word.objects.of(user).filter(Q(known_at__isnull=False) | Exists(passed)).values_list("id", flat=True))
    words = defaultdict(set)
    for sid, wid in live_uses(user).filter(sentence__last__isnull=True).values_list("sentence_id", "word_id"):
        words[sid].add(wid)
    one = {sid: next(iter(ws - familiar)) for sid, ws in words.items() if len(ws - familiar) == 1 and len(ws) > 1}
    if not one:
        return []
    freq = dict(live_uses().filter(word__in=set(one.values())).values("word").annotate(n=Count("sentence", distinct=True))
                .values_list("word", "n"))
    ranked = sorted(one, key=lambda sid: (-freq.get(one[sid], 0), sid))[:limit]
    found = Sentence.objects.select_related("source").prefetch_related("attempts", "decks").in_bulk(ranked)
    lemmas = Word.objects.in_bulk({one[sid] for sid in ranked})
    return [(found[sid], lemmas[one[sid]], freq.get(one[sid], 0)) for sid in ranked if sid in found]


def coverage(source: Source) -> dict:
    """How much of a source's vocabulary you have: its distinct words, by status."""
    ids = set(WordUse.objects.filter(sentence__source=source).values_list("word_id", flat=True))
    words = list(with_counts(Word.objects.filter(id__in=ids)))
    by = defaultdict(list)
    for w in words:
        by[status(w)].append(w)
    new = sorted(by["new"], key=lambda w: (-w.sentences, w.lemma))
    return {"words": len(words), "known": len(by["known"]), "practised": len(by["practised"]), "new": len(new), "top_new": new[:8]}
