"""The work queue: transcribing and rendering run one at a time in a background
thread (one GPU, one Whisper model). Uploads waiting in the inbox are stored as
Source.job = waiting and picked up when nothing asked for in the editor is queued.

Any request can `kick()` the worker; it stops when the queue is empty."""
import itertools
import re
import shutil
import threading
import traceback
from collections import deque

from django.db import close_old_connections, transaction

from library import ingest
from library.models import Source

from . import engine, jpcut

_lock = threading.Lock()
_queue = deque()            # jobs asked for in the editor, ahead of waiting uploads
_jobs = {}                  # id -> Job, the recent ones
_thread = None
_reset = False
_ids = itertools.count(1)


class Job:
    def __init__(self, kind, source, fn=None):
        self.id = next(_ids)
        self.kind, self.source_id, self.title = kind, source.id, str(source)
        self.fn = fn
        self.state = "queued"
        self.log, self.error, self.result, self.duration = [], None, None, None

    def write(self, text):
        self.log.extend(line for line in str(text).splitlines() if line.strip())
        del self.log[:-300]

    def progress(self):
        if not self.duration:
            return None
        for line in reversed(self.log):
            m = re.match(r"\s*\[\s*([\d.]+)\]", line)
            if m:
                return min(1.0, float(m.group(1)) / self.duration)
        return None

    def to_json(self):
        return {"id": self.id, "kind": self.kind, "source": self.source_id, "title": self.title,
                "state": self.state, "log": self.log[-120:], "progress": self.progress(),
                "error": self.error, "result": self.result}


def submit(kind, source, fn):
    """Queue editor work: fn(job) runs in the worker. Returns the job."""
    with _lock:
        for j in _queue:
            if j.kind == kind and j.source_id == source.id:
                return j
        j = Job(kind, source, fn)
        _queue.append(j)
        _remember(j)
    kick()
    return j


def _remember(j):
    _jobs[j.id] = j
    for old in sorted(_jobs)[:-20]:
        _jobs.pop(old, None)


def get(job_id):
    return _jobs.get(job_id)


def current():
    """Running and queued editor jobs, newest first."""
    return [j.to_json() for j in sorted(_jobs.values(), key=lambda j: -j.id)
            if j.state in ("queued", "running")]


def for_source(source_id):
    js = [j for j in _jobs.values() if j.source_id == source_id]
    return max(js, key=lambda j: j.id).to_json() if js else None


def can_transcribe():
    return engine.whisper_installed() and shutil.which("ffmpeg") is not None


def kick():
    """Start the worker if there is something to do and it isn't running."""
    global _thread, _reset
    with _lock:
        if _thread and _thread.is_alive():
            return
        if not _reset:
            # a source left running by a crash or restart goes back in the queue
            Source.objects.filter(job=Source.Job.RUNNING).update(job=Source.Job.WAITING)
            _reset = True
        if not _queue and not (can_transcribe() and Source.objects.filter(job=Source.Job.WAITING).exists()):
            return
        _thread = threading.Thread(target=_work, name="kotoba-worker", daemon=True)
        _thread.start()


def _next():
    with _lock:
        if _queue:
            return _queue.popleft()
    if can_transcribe():
        s = Source.objects.filter(job=Source.Job.WAITING).order_by("created_at").first()
        if s:
            j = Job("transcribe", s, lambda j, s=s: transcribe_source(j, s, upload=True))
            with _lock:
                _remember(j)
            return j
    return None


def _work():
    try:
        while (j := _next()) is not None:
            _run(j)
    finally:
        close_old_connections()


def _run(j):
    j.state = "running"
    jpcut._sink.out = j.write
    try:
        j.result = j.fn(j)
        j.state = "done"
    except Exception as e:  # noqa: BLE001 - reported on the job and in the inbox
        j.write(traceback.format_exc())
        j.error = str(e) or type(e).__name__
        j.state = "error"
    finally:
        jpcut._sink.out = None
        close_old_connections()


def transcribe_source(j, source, upload=False, key=None):
    """Whisper the whole recording, keep the words for the editor and, for a fresh
    upload (or a source without sentences), make its timed sentences."""
    from .models import Cleanup

    key = key or engine.whisper_key()
    path = source.media.path
    if upload:
        Source.objects.filter(pk=source.pk).update(job=Source.Job.RUNNING, job_error="")
    try:
        j.duration = jpcut.probe_duration(path)
        data = engine.transcribe(path, key)
    except Exception as e:
        if upload:
            Source.objects.filter(pk=source.pk).update(job=Source.Job.FAILED, job_error=f"{type(e).__name__}: {e}")
        raise
    rows = ingest.group_words(data["words"])
    with transaction.atomic():
        c, _ = Cleanup.objects.get_or_create(source=source)
        c.words = data
        c.save(update_fields=["words", "updated_at"])
        source.refresh_from_db()
        if upload or source.job or not source.sentences.exists():
            from library.views import _make_sentences
            source.text = "\n".join(r[2] for r in rows)
            source.duration = data.get("duration")
            source.job, source.job_error = Source.Job.NONE, ""
            source.save()
            _make_sentences(source, rows)
    j.write(f"{len(rows)} sentences")
    return {"sentences": len(rows)}
