"""Bring in recordings from a jp-shadow-cut folder: each audio file becomes a source,
with what jp-shadow-cut already made for it (<name>/<name>.words.json, the script and
the edited cut list), so nothing is transcribed twice."""
import json
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from library import ingest
from library.models import Source
from library.views import _make_sentences
from speech import jpcut
from speech.cleanup import cuts_json
from speech.models import Cleanup

AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".webm"}
VIDEO = {".mp4", ".mkv", ".mov"}


class Command(BaseCommand):
    help = "Import jp-shadow-cut recordings (a file, or every recording in a folder)"

    def add_arguments(self, parser):
        parser.add_argument("path", help="a recording, or a folder of them, e.g. ~/jp")
        parser.add_argument("--label", action="append", default=[])
        parser.add_argument("--status", default="inbox", choices=["inbox", "kept"])

    def handle(self, *args, path, label, status, **kw):
        p = Path(path).expanduser().resolve()
        if not p.exists():
            raise CommandError(f"{p} not found")
        files = [p] if p.is_file() else sorted(f for f in p.iterdir() if f.suffix.lower() in AUDIO | VIDEO)
        for src in files:
            self.one(src, label, status)

    def one(self, src, label, status):
        folder = src.parent / src.stem
        words = folder / f"{src.stem}.words.json"
        if Source.objects.filter(title=src.stem.replace("_", " "), kind__in=["audio", "video"]).exists():
            self.stdout.write(f"{src.name}: already here, skipped")
            return
        data = json.loads(words.read_text(encoding="utf-8")) if words.exists() else None
        rows = ingest.group_words(data["words"]) if data else []
        script = jpcut.find_script(src, folder)
        labels = folder / f"{src.stem}_cuts.txt"
        with transaction.atomic():
            s = Source.objects.create(
                kind="video" if src.suffix.lower() in VIDEO else "audio", status=status,
                title=src.stem.replace("_", " "), labels=label[:3],
                duration=data.get("duration") if data else None,
                text="\n".join(r[2] for r in rows), job="" if data else Source.Job.WAITING)
            with open(src, "rb") as f:
                s.media.save(src.name, File(f))
            _make_sentences(s, rows)
            Cleanup.objects.create(
                source=s, words=data, script=jpcut.read_script(script) if script else "",
                cuts=cuts_json(jpcut.read_labels(labels)) if labels.exists() else None)
        what = f"{len(rows)} sentences" if data else "queued for transcription"
        self.stdout.write(f"{src.name}: {what} (source {s.id})")
