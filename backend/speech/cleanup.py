"""The recording editor (jp-shadow-cut's cutter): Whisper's words become a cut list of
retakes, fillers, repeats, off-script speech and long pauses, which you review and
render to a clean recording."""
from django.core.files import File
from django.utils import timezone

from . import engine, jobs, jpcut
from .models import Cleanup

NUMBERS = ("cue_back", "repeat_threshold", "utt_gap", "max_pause", "pad", "lead", "script_match")
FLAGS = ("no_fillers", "no_repeats", "no_script")
WHISPER = ("model", "device", "compute_type")


def defaults():
    d = jpcut.build_parser().parse_args(["x"])
    out = {k: getattr(d, k) for k in NUMBERS + FLAGS}
    out.update(cues=jpcut.DEFAULT_CUES, fillers=[], default_fillers=jpcut.DEFAULT_FILLERS)
    out.update(zip(WHISPER, engine.whisper_key()))
    return out


def clean_settings(raw):
    """Keep known keys, validated the way the CLI would (raises ValueError)."""
    s = {}
    for k in NUMBERS:
        if raw.get(k) not in (None, ""):
            s[k] = float(raw[k]) if k != "cue_back" else int(raw[k])
            if s[k] < 0:
                raise ValueError(f"{k} can't be negative")
    for k in FLAGS:
        s[k] = bool(raw.get(k))
    for k in ("cues", "fillers"):
        if isinstance(raw.get(k), list):
            s[k] = [str(x).strip() for x in raw[k] if str(x).strip()][:20]
    for k in WHISPER:
        if raw.get(k):
            s[k] = str(raw[k]).strip()[:80]
    if s.get("fillers"):
        import re
        for f in s["fillers"]:
            try:
                re.compile(f)
            except re.error as e:
                raise ValueError(f"filler {f!r}: {e}") from e
    return s


def make_args(settings):
    argv = ["x"]
    for k in NUMBERS:
        if settings.get(k) is not None:
            argv += ["--" + k.replace("_", "-"), str(settings[k])]
    for k in FLAGS:
        if settings.get(k):
            argv.append("--" + k.replace("_", "-"))
    for cue in settings.get("cues") or []:
        argv += ["--cue", cue]
    for f in settings.get("fillers") or []:
        argv += ["--filler", f]
    return jpcut.build_parser().parse_args(argv)


def cuts_json(cuts, on=True):
    return [{"start": round(s, 3), "end": round(e, 3), "reason": r, "on": on} for s, e, r in cuts]


def analysis(c):
    """Utterances (chars with times and cut reason), the automatic cuts and the script
    report, from the cached words. Fast: no Whisper involved."""
    if not c.words:
        return {"utts": [], "auto": [], "report": None}
    args = make_args(c.settings)
    script = None if args.no_script or not c.script.strip() else jpcut.parse_script(c.script)
    duration = c.words.get("duration") or c.source.duration or 0
    tl, cuts = jpcut.analyze(c.words, duration, args, script)
    utts = [[[tl.chars[i], round(tl.cs[i], 3), round(tl.ce[i], 3), tl.cut[i]] for i in range(a, b)]
            for a, b in tl.utts]
    return {"utts": utts, "auto": cuts_json(cuts), "report": tl.script_report}


def payload(c):
    a = analysis(c)
    s = c.source
    return {
        "source": s.id, "title": str(s), "kind": s.kind, "media": f"/api/sources/{s.id}/media",
        "duration": (c.words or {}).get("duration") or s.duration,
        "transcribed": bool(c.words), "model": (c.words or {}).get("model"),
        "settings": c.settings, "defaults": defaults(), "script": c.script,
        "utts": a["utts"], "report": a["report"],
        "cuts": c.cuts if c.cuts is not None else a["auto"], "edited": c.cuts is not None,
        "clean": f"/api/sources/{s.id}/clean" if c.clean else None,
        "rendered_at": c.rendered_at, "job": jobs.for_source(s.id),
        "can_transcribe": jobs.can_transcribe(),
    }


def get(source):
    c, _ = Cleanup.objects.select_related("source").get_or_create(source=source)
    return c


def analyze(source, settings, retranscribe=False):
    """Re-run the cut detection with new settings. Needs Whisper's words: when they're
    missing (or a different model was asked for) a transcription job is queued and
    the analysis follows when it's done. Returns (payload, job or None)."""
    c = get(source)
    c.settings = clean_settings(settings)
    c.save(update_fields=["settings", "updated_at"])
    asked = c.settings.get("model")
    stale = c.words and asked and c.words.get("model") != asked
    if not c.words or retranscribe or stale:
        if not jobs.can_transcribe():
            raise RuntimeError("Transcribing needs Whisper and ffmpeg: see Add-ons.")
        key = engine.whisper_key({k: c.settings.get(k) for k in WHISPER})

        def run(j):
            jobs.transcribe_source(j, source, key=key)
            c.refresh_from_db()
            c.cuts = None   # fresh analysis: the automatic cuts
            c.save(update_fields=["cuts", "updated_at"])
            return {"analyzed": True}
        return payload(c), jobs.submit("transcribe", source, run)
    c.cuts = None
    c.save(update_fields=["cuts", "updated_at"])
    return payload(c), None


def render(source, cuts):
    c = get(source)
    c.cuts = cuts
    c.save(update_fields=["cuts", "updated_at"])
    intervals = jpcut.merge([(float(x["start"]), float(x["end"]), x.get("reason") or "manual")
                             for x in cuts if x.get("on", True)])

    def run(j):
        import tempfile
        from pathlib import Path
        j.duration = None
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / f"{Path(source.media.name).stem}_clean.m4a"
            jpcut.render(source.media.path, dst, intervals)
            c.refresh_from_db()
            if c.clean:
                c.clean.delete(save=False)
            with open(dst, "rb") as f:
                c.clean.save(dst.name, File(f), save=False)
        c.rendered_at = timezone.now()
        c.save(update_fields=["clean", "rendered_at", "updated_at"])
        return {"clean": f"/api/sources/{source.id}/clean"}
    return jobs.submit("render", source, run)
