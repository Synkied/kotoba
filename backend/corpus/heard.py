"""What the corpus tells about a word: its lines, the easiest to follow first, each with the line
before and after it; the video's audio, fetched from YouTube the first time one of its lines is
played; and keeping a line, which makes it one of your sentences (one source per video).

The corpus is shared; each user hears the lines of the channels they follow (videos(user)),
except the ones they kept, and keeps lines into their own library."""

import os
import shutil
import threading
import time
from collections import defaultdict
from pathlib import Path

from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone

from library import romanize, srs, translate, words
from library.models import Profile, Sentence, Source, Word

from . import ytdlp
from .models import Channel, Line, Term, TermUse, Video

AUDIO = settings.DATA_DIR / "heard"
AUDIO_EXTS = (".weba", ".m4a", ".opus", ".mp4", ".webm")
AUDIO_DAYS = 30         # a video's audio not played for this long is fetched again when next wanted
CANDIDATES = 3000       # how many of a common word's lines are ranked


# --- turned on or not ------------------------------------------------------------------

def enabled(user) -> bool:
    return bool(translate._load(user).get("youtube", {}).get("enabled"))


def set_enabled(user, on: bool):
    data = translate._load(user)
    translate._save(user, {**data, "youtube": {**data.get("youtube", {}), "enabled": bool(on)}})


def anyone_enabled() -> bool:
    """Whether YouTube may be asked anything at all: someone has the add-on on."""
    return Profile.objects.filter(settings__youtube__enabled=True).exists()


def videos(user):
    """The videos a user hears lines from: those of the channels they follow, searches included."""
    return Video.objects.filter(channels__followers=user)


def kept(user, line_ids) -> dict:
    """{line id: the user's sentence it became}, for the lines they kept."""
    return dict(Line.sentences.through.objects.filter(line__in=line_ids, sentence__source__owner=user)
                .values_list("line_id", "sentence_id"))


def video_sources(user, video_ids) -> dict:
    """{video id: the user's source its kept lines went into}."""
    return dict(Video.sources.through.objects.filter(video__in=video_ids, source__owner=user)
                .values_list("video_id", "source_id"))


# --- reading lines into terms ------------------------------------------------------------

def index_lines(lines) -> None:
    """Cut lines into the dictionary's words, as the word index does with your sentences."""
    stamp = words.engine()
    lines = list(lines)
    found = {line.id: words.segment(line.text) for line in lines}
    keys = {f["key"]: f for fs in found.values() for f in fs}
    with transaction.atomic():
        terms = {t.key: t for t in Term.objects.filter(key__in=keys)}
        new = [Term(key=k, lemma=f["lemma"], reading=f["reading"], entry=f["entry"], search=Term.searchable(f["lemma"], f["reading"]))
               for k, f in keys.items() if k not in terms]
        Term.objects.bulk_create(new, ignore_conflicts=True)
        if new:
            terms = {t.key: t for t in Term.objects.filter(key__in=keys)}
        TermUse.objects.filter(line__in=lines).delete()
        TermUse.objects.bulk_create([TermUse(term=terms[f["key"]], line_id=lid, start=f["start"], end=f["end"], surface=f["surface"])
                                     for lid, fs in found.items() for f in fs])
        for line in lines:
            line.furigana, line.words_engine = romanize.furigana(line.text), stamp
        Line.objects.bulk_update(lines, ["furigana", "words_engine"])


def tidy() -> None:
    """Terms no line uses any more go (after a channel is removed)."""
    Term.objects.exclude(Exists(TermUse.objects.filter(term=OuterRef("pk")))).delete()


# --- a word's lines -----------------------------------------------------------------------

def familiar(user) -> set:
    """Keys of the words you know: marked known, or said well in a sentence."""
    passed = words.live_uses().filter(word=OuterRef("pk"), sentence__last__gte=srs.PASS)
    return set(Word.objects.of(user).filter(Q(known_at__isnull=False) | Exists(passed)).values_list("key", flat=True))


def _length_cost(n: int) -> tuple:
    # 8 to 40 characters say something whole and are easy to repeat
    return (0 if 8 <= n <= 40 else 1, abs(n - 20))


def ranked(term: Term, user, know: set | None = None) -> list:
    """Line ids for a term, the easiest first: fewest other words you don't know yet, a length
    that's easy to repeat, and one line per video before a second from any of them."""
    know = familiar(user) if know is None else know
    uses = (TermUse.objects.filter(term=term, line__video__in=videos(user)).exclude(line__sentences__source__owner=user)
            .values_list("line_id", "line__video_id", "line__video__gone_at", "line__video__yt_id")
            .order_by("line_id")[:CANDIDATES * 2])
    here = {p.stem for p in AUDIO.iterdir()} if AUDIO.exists() else set()
    lines = {}
    for lid, vid, gone, yt in uses:
        if gone and yt not in here:
            continue  # it can't be heard any more
        lines.setdefault(lid, vid)
        if len(lines) >= CANDIDATES:
            break
    if not lines:
        return []
    others = defaultdict(set)
    for lid, key in TermUse.objects.filter(line__in=lines).exclude(term=term).values_list("line_id", "term__key"):
        others[lid].add(key)
    size = dict(Line.objects.filter(id__in=lines).values_list("id", "text"))
    cost = {lid: (len(others[lid] - know), *_length_cost(len(size.get(lid, ""))), lid) for lid in lines}
    order, seen, later = [], set(), []
    for lid in sorted(lines, key=cost.get):
        (later if lines[lid] in seen else order).append(lid)
        seen.add(lines[lid])
    return order + later


def mine(user, lines) -> tuple[dict, dict]:
    """What line_json needs to know of the user's own: the lines they kept, their videos' sources."""
    return kept(user, [l.id for l in lines]), video_sources(user, {l.video_id for l in lines})


def line_json(line: Line, own: tuple[dict, dict], key: str | None = None, spans=None, know: set | None = None,
              neighbours=None) -> dict:
    v = line.video
    out = {"id": line.id, "text": line.text, "furigana": line.furigana, "start": line.start, "end": line.end,
           "position": line.position, "spans": spans if spans is not None else [],
           "sentence": own[0].get(line.id),
           "video": {"id": v.id, "yt_id": v.yt_id, "title": v.title, "uploader": v.uploader, "url": v.url(line.start),
                     "source": own[1].get(v.id), "gone": v.gone_at is not None, "here": audio_path(v) is not None}}
    if neighbours is not None:
        before, after = neighbours
        out["before"] = before.text if before else None
        out["after"] = after.text if after else None
    if know is not None:
        mine = {u.term.key for u in line.uses.all() if u.term.key != key}
        out["new"] = len(mine - know)
    return out


def spans_for(term_key: str, line_ids) -> dict:
    out = defaultdict(list)
    for lid, s, e in TermUse.objects.filter(term__key=term_key, line__in=line_ids).values_list("line_id", "start", "end"):
        out[lid].append([s, e])
    return out


def lines_for(term: Term, user, offset: int = 0, limit: int = 5) -> dict:
    know = familiar(user)
    order = ranked(term, user, know)
    page = order[offset:offset + limit]
    found = Line.objects.select_related("video").prefetch_related("uses__term").in_bulk(page)
    near = defaultdict(dict)
    if page:
        q = Q()
        for lid in page:
            ln = found[lid]
            q |= Q(video_id=ln.video_id, position__in=[ln.position - 1, ln.position + 1])
        for n in Line.objects.filter(q):
            near[n.video_id][n.position] = n
    spans = spans_for(term.key, page)
    own = mine(user, found.values())
    out = []
    for lid in page:
        ln = found[lid]
        out.append(line_json(ln, own, term.key, spans[lid], know,
                             (near[ln.video_id].get(ln.position - 1), near[ln.video_id].get(ln.position + 1))))
    videos = Line.objects.filter(id__in=order).values("video").distinct().count() if order else 0
    return {"lines": out, "total": len(order), "videos": videos}


def context(line: Line, user, radius: int = 6, term_key: str | None = None) -> list:
    """The lines around one, in order."""
    around = list(Line.objects.filter(video=line.video, position__gte=line.position - radius,
                                      position__lte=line.position + radius).select_related("video"))
    spans = spans_for(term_key, [l.id for l in around]) if term_key else {}
    own = mine(user, around)
    return [line_json(l, own, spans=spans.get(l.id, [])) for l in around]


def counts(keys, user) -> dict:
    """{key: lines you could hear it in}, for keys in the corpus."""
    return dict(TermUse.objects.filter(term__key__in=keys, line__video__in=videos(user), line__video__gone_at__isnull=True)
                .exclude(line__sentences__source__owner=user)
                .values("term__key").annotate(n=Count("line", distinct=True)).values_list("term__key", "n"))


# --- hearing a line ----------------------------------------------------------------------

_locks: dict[int, threading.Lock] = defaultdict(threading.Lock)
_failed: dict[int, str] = {}   # source id -> why its video's audio couldn't be fetched, for a kept line


def audio_path(video: Video) -> Path | None:
    """The video's audio, if it's here."""
    for ext in AUDIO_EXTS:
        p = AUDIO / f"{video.yt_id}{ext}"
        if p.exists():
            return p
    return None


def fetch(video: Video) -> Path:
    """The video's audio, fetched from YouTube the first time (a few seconds), then kept for
    AUDIO_DAYS after it's last played. A video that's gone is marked so."""
    with _locks[video.id]:
        path = audio_path(video)
        if not path:
            try:
                path = ytdlp.audio(video.yt_id, AUDIO)
            except ytdlp.YtError as e:
                if e.kind in ("gone", "members"):
                    Video.objects.filter(pk=video.pk, gone_at__isnull=True).update(gone_at=timezone.now())
                raise
    try:
        os.utime(path)  # played: it stays another AUDIO_DAYS
    except OSError:
        pass
    return path


def sweep() -> int:
    """Audio not played for AUDIO_DAYS goes. Kept lines don't need it: their source has its own copy."""
    if not AUDIO.exists():
        return 0
    old = time.time() - AUDIO_DAYS * 86400
    gone = 0
    for f in AUDIO.iterdir():
        try:
            if f.is_file() and f.stat().st_mtime < old:
                f.unlink()
                gone += 1
        except OSError:
            pass
    return gone


# --- keeping a line ------------------------------------------------------------------------

def audio_state(video: Video, source_id: int) -> str | None:
    """'fetching' while a kept video's audio is on its way, 'failed: …', or None."""
    if source_id in _failed:
        return f"failed: {_failed[source_id]}"
    return "fetching" if _locks[video.id].locked() else None


def _give_source_audio(video_id: int, source_id: int):
    """Copy the video's audio into the source its lines were kept in, fetching it first if need be."""
    try:
        video = Video.objects.get(pk=video_id)
        src = Source.objects.filter(pk=source_id).first()
        if not src or src.media:
            return
        cached = fetch(video)
        name = f"media/youtube-{video.yt_id}-{src.id}{cached.suffix}"  # each user's source has its own copy
        dest = Path(settings.MEDIA_ROOT) / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cached, dest)
        Source.objects.filter(pk=src.pk).update(media=name, duration=video.duration)
        _failed.pop(source_id, None)
    except Exception as e:  # noqa: BLE001 - shown on the word page; keeping again retries
        _failed[source_id] = str(e)[:300]


def _in_background(video_id: int, source_id: int):
    close_old_connections()
    try:
        _give_source_audio(video_id, source_id)
    finally:
        close_old_connections()


def give_source_audio(video: Video, source: Source):
    """The kept video's source gets the audio: at once when it's here, else once it's fetched."""
    _failed.pop(source.id, None)
    if audio_path(video):
        _give_source_audio(video.id, source.id)
    else:
        threading.Thread(target=_in_background, args=(video.id, source.id), daemon=True, name=f"audio-{video.yt_id}").start()


def keep(line: Line, user) -> Sentence:
    """Make a line one of the user's sentences: in the video's source of theirs (made the first
    time, in the inbox), timed against the video's audio, which is fetched in the background."""
    with transaction.atomic():
        line = Line.objects.select_related("video").get(pk=line.pk)
        video = line.video
        done = line.sentences.filter(source__owner=user).select_related("source").first()
        if done:
            if not done.source.media:
                give_source_audio(video, done.source)  # it failed last time
            return done
        src = video.sources.filter(owner=user).first()
        if src is None:
            src = Source.objects.create(owner=user, kind=Source.Kind.AUDIO, status=Source.Status.INBOX,
                                        title=(video.title or video.yt_id)[:200], duration=video.duration)
            video.sources.add(src)
        sentence = Sentence.objects.create(source=src, text=line.text, start=line.start, end=line.end, position=0)
        ordered = sorted(src.sentences.all(), key=lambda s: (s.start is None, s.start or 0, s.id))
        for i, s in enumerate(ordered):
            if s.position != i:
                Sentence.objects.filter(pk=s.pk).update(position=i)
        Source.objects.filter(pk=src.pk).update(text="\n".join(s.text for s in ordered))
        line.sentences.add(sentence)
    if not src.media:
        give_source_audio(video, src)
    words.kick()
    return sentence


# --- what's in it -----------------------------------------------------------------------------

def summary() -> dict:
    """Per channel: its videos by subtitle state and the lines read from them."""
    by = defaultdict(lambda: defaultdict(int))
    for cid, subs, n in Video.objects.values_list("channels", "subs").annotate(n=Count("id", distinct=True)):
        by[cid][subs] = n
    lines = dict(Line.objects.values("video__channels").annotate(n=Count("id")).values_list("video__channels", "n"))
    return {"by": by, "lines": lines}
