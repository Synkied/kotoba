"""Transcribe uploaded audio/video waiting in the inbox now, in this process. The
server does this by itself in the background; this is for a big backlog or to see
the progress in a terminal."""
from django.core.management.base import BaseCommand, CommandError

from library.models import Source
from speech import engine, jobs


class Command(BaseCommand):
    help = "Transcribe waiting audio/video sources with Whisper"

    def add_arguments(self, parser):
        parser.add_argument("--model", default="")
        parser.add_argument("--device", default="")
        parser.add_argument("--compute-type", default="")

    def handle(self, *args, model, device, compute_type, **kw):
        if not jobs.can_transcribe():
            raise CommandError("Transcribing needs Whisper and ffmpeg: install kotoba's whisper extra "
                               "(uv sync --extra whisper) and ffmpeg.")
        key = engine.whisper_key({"model": model, "device": device, "compute_type": compute_type})
        self.stdout.write(f"Whisper {' / '.join(key)}")
        Source.objects.filter(job=Source.Job.RUNNING).update(job=Source.Job.WAITING)
        for s in Source.objects.filter(job=Source.Job.WAITING).order_by("created_at"):
            self.stdout.write(f"Transcribing {s}…")
            j = jobs.Job("transcribe", s)
            j.write = lambda text: self.stdout.write("  " + str(text))
            from speech import jpcut
            jpcut._sink.out = j.write
            try:
                jobs.transcribe_source(j, s, upload=True, key=key)
            except Exception as e:  # noqa: BLE001 - recorded on the source
                self.stderr.write(f"  failed: {e}")
            finally:
                jpcut._sink.out = None
