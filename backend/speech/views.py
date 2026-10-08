import shutil

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from library import dictionary
from library.models import Source

from . import cleanup, engine, jobs, jpscore
from .models import Cleanup

RECORDED = (Source.Kind.AUDIO, Source.Kind.VIDEO)


# ---------------------------------------------------------------- practice engine

def _key(request, *, query_only=False):
    q = request.query_params if request.method == "GET" or query_only else {**request.query_params.dict(), **request.data}
    return engine.whisper_key({k: q.get(k) for k in ("model", "device", "compute_type")})


@api_view(["GET"])
def engine_status(request):
    return Response(engine.status(_key(request)))


@api_view(["POST"])
def engine_load(request):
    key = _key(request)
    engine.load(key)
    return Response(engine.status(key))


@api_view(["POST"])
def engine_score(request):
    """16 kHz mono int16 PCM in the body; ?expected=<sentence>&final=1"""
    if not engine.whisper_installed():
        return Response({"error": "Whisper isn't installed"}, status=503)
    if len(request.body) > engine.MAX_CLIP_S * 16000 * 2:
        return Response({"error": f"clip longer than {engine.MAX_CLIP_S}s"}, status=413)
    q = request.query_params
    res, status = engine.score(request.body, q.get("expected", ""), q.get("final") == "1", _key(request, query_only=True),
                               busy=lambda: next((j["title"] for j in jobs.current() if j["state"] == "running"),
                                                 "another clip"))
    return Response(res, status=status)


@api_view(["POST"])
def engine_prepare(request):
    """A script -> sentences with display units (furigana)."""
    text = str(request.data.get("text") or "")
    return Response({"sentences": jpscore.prepare(text), "readings": jpscore.has_readings()})


@api_view(["GET"])
def engine_tts(request):
    q = request.query_params
    try:
        wav = engine.tts(q.get("text", ""), q.get("voice", ""), q.get("speed", 1))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    except RuntimeError as e:
        return Response({"error": str(e)}, status=503)
    resp = HttpResponse(wav, content_type="audio/wav")
    resp["Cache-Control"] = "max-age=3600"
    return resp


@api_view(["GET"])
def engine_tts_status(request):
    return Response(engine.tts_status())


@api_view(["POST"])
def engine_tts_load(request):
    return Response(engine.kokoro_load())


@api_view(["GET"])
def addons(request):
    """What kotoba can do on this machine, and what is missing."""
    jobs.kick()
    key = engine.whisper_key()
    tts = engine.tts_status()
    last = (Source.objects.filter(kind=Source.Kind.CAPTURE).order_by("-created_at")
            .values_list("created_at", flat=True).first())
    return Response({
        "whisper": engine.status(key),
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "voices": {"count": len(tts["voices"]), "kokoro": tts["kokoro"], "kokoro_error": tts["kokoro_error"],
                   "voicevox": tts["voicevox"], "voicevox_url": tts["voicevox_url"]},
        "queue": {"waiting": Source.objects.filter(job__in=[Source.Job.WAITING, Source.Job.RUNNING]).count(),
                  "failed": Source.objects.filter(job=Source.Job.FAILED).count(),
                  "jobs": jobs.current()},
        "screen_ocr": {"last_capture": last},
        "dictionary": dictionary.status(),
    })


# ---------------------------------------------------------------- jobs

@api_view(["GET"])
def job(request, job_id):
    j = jobs.get(job_id)
    if not j:
        return Response({"error": "that job is gone (the server restarted?)"}, status=404)
    return Response(j.to_json())


@api_view(["GET"])
def job_list(request):
    return Response(jobs.current())


# ---------------------------------------------------------------- recording editor

def _recorded(pk):
    s = get_object_or_404(Source, pk=pk)
    if s.kind not in RECORDED or not s.media:
        return None
    return s


def _no_media():
    return Response({"error": "Only audio and video sources can be cleaned up."}, status=400)


@api_view(["GET"])
def recordings(request):
    """Audio/video sources with where they are in the editor."""
    out = []
    qs = (Source.objects.filter(kind__in=RECORDED).exclude(media="")
          .exclude(status=Source.Status.ARCHIVED).select_related("cleanup").order_by("-created_at"))
    for s in qs[:300]:
        c = getattr(s, "cleanup", None)
        out.append({"id": s.id, "title": str(s), "kind": s.kind, "status": s.status, "labels": s.labels,
                    "duration": s.duration, "created_at": s.created_at, "job": s.job,
                    "transcribed": bool(c and c.words), "script": bool(c and c.script.strip()),
                    "edited": bool(c and c.cuts is not None), "rendered": bool(c and c.clean),
                    "sentences": s.sentences.count()})
    return Response(out)


@api_view(["GET"])
def source_cleanup(request, pk):
    s = _recorded(pk)
    if not s:
        return _no_media()
    return Response(cleanup.payload(cleanup.get(s)))


@api_view(["POST"])
def source_analyze(request, pk):
    s = _recorded(pk)
    if not s:
        return _no_media()
    try:
        data, j = cleanup.analyze(s, request.data.get("settings") or {}, bool(request.data.get("retranscribe")))
    except ValueError as e:
        return Response({"error": f"invalid setting: {e}"}, status=400)
    except RuntimeError as e:
        return Response({"error": str(e)}, status=503)
    return Response({**data, "job": j.to_json() if j else data["job"]})


@api_view(["PUT"])
def source_cuts(request, pk):
    s = _recorded(pk)
    if not s:
        return _no_media()
    cuts = _clean_cuts(request.data.get("cuts"))
    if cuts is None:
        return Response({"error": "cuts: a list of {start, end, reason, on}"}, status=400)
    Cleanup.objects.update_or_create(source=s, defaults={"cuts": cuts})
    return Response({"saved": len(cuts)})


def _clean_cuts(raw):
    if not isinstance(raw, list):
        return None
    out = []
    for x in raw:
        try:
            a, b = float(x["start"]), float(x["end"])
        except (KeyError, TypeError, ValueError):
            return None
        if b > a >= 0:
            out.append({"start": round(a, 3), "end": round(b, 3), "reason": str(x.get("reason") or "manual")[:300],
                        "on": bool(x.get("on", True))})
    return out


@api_view(["PUT"])
def source_script(request, pk):
    s = _recorded(pk)
    if not s:
        return _no_media()
    text = str(request.data.get("text") or "").strip()
    c = cleanup.get(s)
    c.script = text + "\n" if text else ""
    c.save(update_fields=["script", "updated_at"])
    from . import jpcut
    return Response({"script": c.script, "sentences": len(jpcut.parse_script(c.script))})


@api_view(["POST"])
def source_render(request, pk):
    s = _recorded(pk)
    if not s:
        return _no_media()
    cuts = _clean_cuts(request.data.get("cuts"))
    if cuts is None:
        return Response({"error": "cuts: a list of {start, end, reason, on}"}, status=400)
    if not shutil.which("ffmpeg"):
        return Response({"error": "Rendering needs ffmpeg; see Add-ons."}, status=503)
    return Response(cleanup.render(s, cuts).to_json())


@api_view(["GET"])
def source_peaks(request, pk):
    s = get_object_or_404(Source, pk=pk)
    if not s.media:
        return Response({"error": "This source has no audio."}, status=400)
    c = cleanup.get(s)
    if c.peaks is None:
        if not shutil.which("ffmpeg"):
            return Response({"error": "The waveform needs ffmpeg; see Add-ons."}, status=503)
        c.peaks = engine.peaks(s.media.path)
        c.save(update_fields=["peaks", "updated_at"])
    return Response(c.peaks)


@api_view(["GET"])
def source_clean(request, pk):
    from library.views import ranged_file
    s = _recorded(pk)
    c = getattr(s, "cleanup", None) if s else None
    if not c or not c.clean:
        return Response({"error": "not rendered yet"}, status=404)
    resp = ranged_file(request, c.clean.path)
    if "dl" in request.query_params:
        from urllib.parse import quote
        name = f"{s.title or 'recording'}_clean.m4a"
        resp["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(name)}"
    resp["Cache-Control"] = "no-cache"
    return resp
