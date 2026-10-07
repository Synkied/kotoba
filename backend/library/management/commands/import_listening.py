"""Import a reviewed exercise manifest with its local PDF/audio files."""
import io
import json
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from pypdf import PdfReader
from PIL.PngImagePlugin import PngInfo

from library.models import ListeningLesson, ListeningExercise


class Command(BaseCommand):
    help = "Import lesson 18 from a listening folder, or another lesson with --manifest. Re-running updates it without duplicating attempts."

    def add_arguments(self, parser):
        parser.add_argument("folder", type=Path)
        parser.add_argument("--manifest", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "minna18-listening.json")

    def handle(self, *args, **options):
        folder = options["folder"].resolve()
        try:
            manifest = json.loads(options["manifest"].read_text())
            pdf_path = (folder / manifest["pdf"]).resolve()
            paths = [pdf_path, *[(folder / e["audio"]).resolve() for e in manifest["exercises"]]]
            for path in paths:
                if folder not in path.parents or not path.is_file():
                    raise CommandError(f"Missing file or path outside the listening folder: {path.name}")
            # Prepare every asset before changing the database.
            pdf = PdfReader(pdf_path)
            images = {}
            for exercise in manifest["exercises"]:
                if "crop" not in exercise:
                    continue
                page_images = list(pdf.pages[exercise["page"]].images)
                if len(page_images) != 1:
                    raise CommandError("This manifest expects a scanned page with one image. Supply a reviewed manifest for this PDF.")
                image = page_images[0].image.convert("RGB")
                rect = exercise["crop"]
                crop = image.crop(tuple(round(v * (image.width if i % 2 == 0 else image.height)) for i, v in enumerate(rect)))
                out = io.BytesIO()
                provenance = PngInfo()
                provenance.add_text("Source", f"User-supplied {pdf_path.name}; page {exercise['page'] + 1}; normalized crop {rect}")
                crop.save(out, format="PNG", pnginfo=provenance)
                images[exercise["position"]] = out.getvalue()
        except (OSError, ValueError, KeyError, IndexError) as error:
            raise CommandError(f"Could not read the listening material: {error}") from error

        with transaction.atomic():
            lesson, created = ListeningLesson.objects.get_or_create(slug=manifest["slug"], defaults={"title": manifest["title"]})
            lesson.title = manifest["title"]
            lesson.description = manifest.get("description", "")
            # Stable storage names keep repeat imports from accumulating files.
            def save_file(field, name, data):
                target = f"listening/{lesson.slug}/{name}"
                if field.storage.exists(target):
                    field.storage.delete(target)
                field.name = field.storage.save(target, ContentFile(data))

            save_file(lesson.pdf, "worksheet.pdf", pdf_path.read_bytes())
            lesson.save()
            for item in manifest["exercises"]:
                exercise, _ = ListeningExercise.objects.get_or_create(lesson=lesson, position=item["position"])
                for field in ("title", "instructions", "example", "questions", "image_alt"):
                    setattr(exercise, field, item.get(field, [] if field == "questions" else ""))
                save_file(exercise.audio, f"track-{item['position']}.mp3", (folder / item["audio"]).read_bytes())
                if item["position"] in images:
                    save_file(exercise.image, f"exercise-{item['position']}.png", images[item["position"]])
                exercise.save()
        self.stdout.write(self.style.SUCCESS(f"{'Imported' if created else 'Updated'} {lesson.title}: {lesson.exercises.count()} exercises. Open /listening."))
