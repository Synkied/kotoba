"""Create a local worksheet/audio package from a single multipart upload."""
import hashlib
import io
import json
from pathlib import Path
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import transaction
from PIL.PngImagePlugin import PngInfo
from pypdf import PdfReader

from .models import ListeningLesson, ListeningExercise

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".webm", ".aiff", ".aif"}


def png(image, source, rect=None):
    image = image.convert("RGB")
    if rect:
        image = image.crop(tuple(round(value * (image.width if i % 2 == 0 else image.height)) for i, value in enumerate(rect)))
    output = io.BytesIO()
    metadata = PngInfo()
    metadata.add_text("Source", source)
    image.save(output, format="PNG", pnginfo=metadata)
    return output.getvalue()


def fingerprint(upload):
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()


def import_package(files, title):
    if len(files) < 2 or len(files) > 51:
        raise ValueError("Choose one PDF and between 1 and 50 audio files together.")
    pdfs = [f for f in files if Path(f.name).suffix.lower() == ".pdf"]
    audios = [f for f in files if Path(f.name).suffix.lower() in AUDIO_EXTENSIONS]
    if len(pdfs) != 1 or not audios or len(pdfs) + len(audios) != len(files):
        raise ValueError("A quiz package needs exactly one PDF and one or more audio files. Remove other file types.")
    if any(not f.size for f in files):
        raise ValueError("One of these files is empty. Choose the original file again.")
    if sum(f.size for f in files) > 100 * 1024 * 1024:
        raise ValueError("This package exceeds 100 MB. Choose the files for one lesson at a time.")
    worksheet = pdfs[0]
    template = json.loads((Path(__file__).parent / "data" / "minna18-listening.json").read_text())
    recognized = fingerprint(worksheet) == template.get("pdf_sha256")
    keyed_audio = {fingerprint(f): f for f in audios} if recognized else {}
    recognized = recognized and len(audios) == len(template["exercises"]) and all(e.get("audio_sha256") in keyed_audio for e in template["exercises"])
    if not isinstance(title, str):
        raise ValueError("Enter a package name as text.")
    title = title.strip() or (template["title"] if recognized else Path(worksheet.name).stem)
    if len(title) > 200:
        raise ValueError("Package names can contain up to 200 characters.")
    try:
        pdf = PdfReader(worksheet)
        if pdf.is_encrypted:
            raise ValueError("This PDF is password protected. Upload an unlocked copy.")
        if not 1 <= len(pdf.pages) <= 100:
            raise ValueError("Choose a PDF with between 1 and 100 pages for this package.")
        pages, source_images = [], {}
        for number, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            images = list(page.images)
            image_data = None
            # A full-page scan is useful as the worksheet; unrelated embedded
            # figures in a vector PDF must not be presented as the full page.
            if len(images) == 1 and not text.strip():
                source_images[number] = images[0].image
                image_data = png(images[0].image, f"User-supplied {worksheet.name}; page {number}")
            pages.append({"number": number, "text": text, "data": image_data})
        crops = {}
        if recognized:
            for item in template["exercises"]:
                if "crop" in item:
                    number = item["page"] + 1
                    crops[item["position"]] = png(source_images[number], f"User-supplied {worksheet.name}; page {number}; crop {item['crop']}", item["crop"])
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("This PDF could not be read. Check that it opens normally, then choose it again.") from error
    saved_files = []
    storage = ListeningLesson._meta.get_field("pdf").storage
    try:
        with transaction.atomic():
            lesson = ListeningLesson.objects.create(slug=f"package-{uuid4().hex}", title=title, description=template["description"] if recognized else f"{len(audios)} recordings · {len(pages)} worksheet pages")

            def save(name, content):
                path = storage.save(f"listening/{lesson.slug}/{name}", content)
                saved_files.append(path)
                return path

            worksheet.seek(0)
            lesson.pdf.name = save("worksheet.pdf", worksheet)
            lesson.pages = [{"number": p["number"], "text": p["text"], "image": save(f"page-{p['number']}.png", ContentFile(p["data"])) if p["data"] else None} for p in pages]
            lesson.save()
            for index, audio in enumerate(audios, 1):
                item = template["exercises"][index - 1] if recognized else None
                if item:
                    audio = keyed_audio[item["audio_sha256"]]
                exercise = ListeningExercise(
                    lesson=lesson, position=index, title=item["title"] if item else Path(audio.name).stem,
                    instructions=item["instructions"] if item else "Listen to this recording and answer the questions from your worksheet.",
                    example=item.get("example", "") if item else "", questions=item["questions"] if item else [],
                    worksheet_page=item.get("page", 0) + 1 if item else min(index, len(pages)),
                    image_alt=item.get("image_alt", "") if item else "",
                )
                audio.seek(0)
                exercise.audio.name = save(f"track-{index}{Path(audio.name).suffix.lower()}", audio)
                if index in crops:
                    exercise.image.name = save(f"exercise-{index}.png", ContentFile(crops[index]))
                exercise.save()
        return lesson
    except Exception:
        for path in saved_files:
            storage.delete(path)
        raise
