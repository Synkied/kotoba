"""The corpus in the background: one thread reads the video lists of the channels you follow, then
each new video's subtitles, then cuts their lines into words. "Find more" searches go first.
kotoba isn't always on, so there's no schedule: whatever is due is done when kotoba is next
asked (kick() from the app's polling), and a channel is read again after REFRESH.

YouTube is only asked when the add-on is on."""

import random
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from django.db import close_old_connections, transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from library import words

from . import heard, ytdlp
from .models import Channel, Line, Video

REFRESH = timedelta(hours=12)
PARALLEL = 2            # videos looked at once; YouTube doesn't like more
BATCH = 10
PACE = (1.0, 2.5)       # seconds of rest before each video, so a channel doesn't look like a scraper
BACKOFF = (600, 7200)   # when YouTube says too many requests: wait 10 minutes, doubling up to 2 hours
SEARCH_SIZE = 20        # videos a "Find more" looks at

_lock = threading.Lock()
_thread = None
_tools = {"state": "", "error": ""}   # installing yt-dlp: "", "installing", "failed"
state = {"doing": "", "error": "", "last_sweep": 0.0, "last_update": 0.0, "updated": "",
         "paused_until": 0.0, "backoff": 0}


def paused() -> float:
    """Until when YouTube asked for a rest (a timestamp), or 0."""
    return state["paused_until"] if state["paused_until"] > time.time() else 0.0


def _throttled():
    wait = min(BACKOFF[1], state["backoff"] * 2 or BACKOFF[0])
    state.update(backoff=wait, paused_until=time.time() + wait)
UPDATE_EVERY = 86400


def _update_due() -> bool:
    return ytdlp._zipapp().exists() and time.time() - state["last_update"] > UPDATE_EVERY


def _due_channels():
    stale = timezone.now() - REFRESH
    return (Channel.objects.exclude(kind=Channel.Kind.SEARCH).filter(checked_at__isnull=True) |
            Channel.objects.exclude(kind=Channel.Kind.SEARCH).filter(checked_at__lt=stale))


def _waiting_videos():
    searched = Channel.objects.filter(videos=OuterRef("pk"), kind=Channel.Kind.SEARCH)
    return Video.objects.filter(subs=Video.Subs.WAITING).annotate(searched=Exists(searched)).order_by("-searched", "id")


def _work_left() -> bool:
    return (Channel.objects.filter(kind=Channel.Kind.SEARCH, checked_at__isnull=True).exists()
            or _due_channels().exists() or Video.objects.filter(subs=Video.Subs.WAITING).exists()
            or Line.objects.exclude(words_engine=words.engine()).exists())


def kick() -> None:
    """Start the worker if the add-on is on and something is due. Cheap to call often."""
    global _thread
    if not heard.enabled():
        return
    if ytdlp.missing() and not _tools["state"]:
        install_tools()  # the first fetch was cut short (kotoba stopped halfway); it starts reading once done
        return
    if not ytdlp.available() or paused():
        return
    with _lock:
        if _thread and _thread.is_alive():
            return
        if not _update_due() and not _work_left():
            return
        _thread = threading.Thread(target=_run, daemon=True, name="corpus")
        _thread.start()


def busy() -> bool:
    return bool(_thread and _thread.is_alive())


def _run():
    close_old_connections()
    try:
        if _update_due():  # each day kotoba runs, before asking YouTube anything
            state["doing"] = "Updating yt-dlp"
            state["last_update"] = time.time()
            try:
                state["updated"] = ytdlp.update()
            except Exception as e:  # noqa: BLE001 - the old one still works, most days
                state["updated"] = f"Couldn't update: {e}"[:300]
        while heard.enabled() and not paused():
            if _searches() or _channels() or _videos() or _index():
                continue
            break
        if time.time() - state["last_sweep"] > 86400:
            heard.sweep()
            state["last_sweep"] = time.time()
        state.update(doing="", error="")
    except Exception as e:  # noqa: BLE001 - shown in Add-ons; the next kick tries again
        traceback.print_exc()
        state.update(doing="", error=str(e)[:500])
    finally:
        close_old_connections()


def _add_videos(channel: Channel, entries: list):
    known = dict(Video.objects.filter(yt_id__in=[e["id"] for e in entries]).values_list("yt_id", "id"))
    with transaction.atomic():
        new = [Video(yt_id=e["id"], title=e["title"][:300], duration=e.get("duration")) for e in entries if e["id"] not in known]
        Video.objects.bulk_create(new, ignore_conflicts=True)
        ids = Video.objects.filter(yt_id__in=[e["id"] for e in entries]).values_list("id", flat=True)
        channel.videos.add(*ids)


def _searches() -> bool:
    ch = Channel.objects.filter(kind=Channel.Kind.SEARCH, checked_at__isnull=True).first()
    if not ch:
        return False
    state["doing"] = f"Searching YouTube for {ch.title}"
    try:
        _add_videos(ch, ytdlp.search(ch.title, SEARCH_SIZE))
        ch.error = ""
    except ytdlp.YtError as e:
        if e.kind == "throttled":
            _throttled()
            return True
        ch.error = str(e)
    ch.checked_at = timezone.now()
    ch.save(update_fields=["error", "checked_at"])
    return True


def _channels() -> bool:
    ch = _due_channels().order_by("checked_at", "id").first()
    if not ch:
        return False
    state["doing"] = f"Reading the video list of {ch}"
    try:
        title, entries = ytdlp.listing(ch.url)
        if title and not ch.title:
            ch.title = title[:200]
        _add_videos(ch, entries)
        ch.videos.filter(subs=Video.Subs.FAILED).update(subs=Video.Subs.WAITING)  # another try
        ch.error = ""
    except ytdlp.YtError as e:
        if e.kind == "throttled":
            _throttled()
            return True
        ch.error = str(e)
    ch.checked_at = timezone.now()
    ch.save(update_fields=["title", "error", "checked_at"])
    return True


def _look(video_id: int):
    """One video: its details and, when it has human-made Japanese subtitles, their cues."""
    if PACE[1]:
        time.sleep(random.uniform(*PACE))
    v, meta = Video.objects.get(pk=video_id), None
    try:
        meta = ytdlp.info(v.yt_id)
        track = ytdlp.japanese_track(meta)
        return v, meta, ytdlp.subtitles(track) if track else None, None
    except ytdlp.YtError as e:
        return v, meta, None, e


def _look_in_pool(video_id: int):
    close_old_connections()
    try:
        return _look(video_id)
    finally:
        close_old_connections()


def _videos() -> bool:
    batch = list(_waiting_videos().values_list("id", flat=True)[:BATCH])
    if not batch:
        return False
    left = Video.objects.filter(subs=Video.Subs.WAITING).count()
    state["doing"] = f"Reading subtitles: {left} video{'s' if left != 1 else ''} to go"
    if PARALLEL > 1:
        with ThreadPoolExecutor(PARALLEL) as pool:
            results = list(pool.map(_look_in_pool, batch))
    else:
        results = [_look(v) for v in batch]
    if any(err and err.kind == "throttled" for _, _, _, err in results):
        _throttled()  # those stay waiting; they're read again once the rest is over
        results = [r for r in results if not (r[3] and r[3].kind == "throttled")]
    else:
        state["backoff"] = 0
    for v, meta, cues, err in results:
        if meta:
            v.title = (meta.get("title") or v.title)[:300]
            v.uploader = (meta.get("channel") or meta.get("uploader") or "")[:200]
            v.duration = meta.get("duration") or v.duration
            up = meta.get("upload_date") or ""
            if len(up) == 8:
                v.published = date(int(up[:4]), int(up[4:6]), int(up[6:]))
        if err:
            v.subs = Video.Subs.MEMBERS if err.kind in ("members", "gone") else Video.Subs.FAILED
            v.error = str(err)
            if err.kind == "gone":
                v.gone_at = timezone.now()
        elif not cues:
            v.subs, v.error = Video.Subs.NONE, ""
        else:
            v.subs, v.error = Video.Subs.OK, ""
            with transaction.atomic():
                v.lines.filter(sentence__isnull=True).delete()
                Line.objects.bulk_create([Line(video=v, position=i, start=s, end=e, text=t) for i, (s, e, t) in enumerate(cues)],
                                         ignore_conflicts=True)
        v.save()
        if cues:
            heard.index_lines(v.lines.all())  # here, not in the pool: MeCab isn't shared across threads
    return True


def _index() -> bool:
    stamp = words.engine()
    batch = list(Line.objects.exclude(words_engine=stamp).order_by("id")[:500])
    if not batch:
        return False
    state["doing"] = "Finding words in the lines"
    heard.index_lines(batch)
    return True


# --- the tools ------------------------------------------------------------------------------

def install_tools():
    """Fetch yt-dlp (and deno, when there's no runtime) in the background, then start reading."""
    with _lock:
        if _tools["state"] == "installing":
            return
        _tools.update(state="installing", error="")

    def run():
        try:
            ytdlp.install()
            _tools.update(state="", error="")
        except Exception as e:  # noqa: BLE001
            _tools.update(state="failed", error=str(e)[:300])
        close_old_connections()
        kick()

    threading.Thread(target=run, daemon=True, name="corpus-tools").start()


def tools_state() -> dict:
    return dict(_tools)
