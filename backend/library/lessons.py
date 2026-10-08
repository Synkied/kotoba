"""Lessons: material to study, kept together until it's done. Done lessons leave the
current list for the archive; pinned ones stay at the top whatever their state."""
from pathlib import Path

from django.core.files import File
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import Lesson, LessonFile, Source
from .views import AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, ranged_file

PDF_EXT = {".pdf"}
TEXT_EXT = {".txt", ".md"}
# only what a browser shows without running it: no HTML or SVG served from kotoba's origin
ALLOWED_EXT = PDF_EXT | AUDIO_EXT | VIDEO_EXT | IMAGE_EXT | TEXT_EXT | {".gif"}
MAX_FILES = 50


def file_kind(name):
    ext = Path(name).suffix.lower()
    return ("pdf" if ext in PDF_EXT else "audio" if ext in AUDIO_EXT else "video" if ext in VIDEO_EXT
            else "image" if ext in IMAGE_EXT | {".gif"} else "text")


def file_error(files, existing=0):
    if existing + len(files) > MAX_FILES:
        return f"A lesson holds up to {MAX_FILES} files."
    for f in files:
        if Path(f.name).suffix.lower() not in ALLOWED_EXT:
            return f"{f.name}: lessons keep PDFs, audio, video, images and text files."
        if not f.size:
            return f"{f.name} is empty. Choose the original file again."
    return None


def add_files(lesson, files):
    start = lesson.files.count()
    for i, f in enumerate(files):
        LessonFile.objects.create(lesson=lesson, file=f, name=Path(f.name).name[:200], position=start + i)


class LessonSerializer(serializers.ModelSerializer):
    done = serializers.BooleanField(write_only=True, required=False)
    sources = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Source.objects.all())

    class Meta:
        model = Lesson
        fields = ["id", "title", "notes", "pinned", "done", "done_at", "created_at", "sources"]
        read_only_fields = ["done_at", "created_at"]

    def validate_title(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Give the lesson a title.")
        return value

    def update(self, lesson, data):
        if "done" in data:
            done = data.pop("done")
            if done != (lesson.done_at is not None):
                lesson.done_at = timezone.now() if done else None
        return super().update(lesson, data)

    def to_representation(self, lesson):
        out = super().to_representation(lesson)
        out["files"] = [{"id": f.id, "name": f.name, "kind": file_kind(f.name),
                         "url": f"/api/lessons/{lesson.id}/files/{f.id}",
                         "source": f.source_id, "job": f.source.job if f.source else None,
                         "job_error": f.source.job_error if f.source else ""} for f in lesson.files.all()]
        out["sources"] = [{"id": s.id, "title": str(s) or "Untitled", "kind": s.kind, "status": s.status,
                           "sentences": len(s.sentences.all()), "job": s.job,
                           "media": f"/api/sources/{s.id}/media" if s.media else None} for s in lesson.sources.all()]
        from speech import jobs
        out["can_transcribe"] = jobs.can_transcribe()
        return out


class LessonViewSet(viewsets.ModelViewSet):
    """?state=done is the archive, newest done first; otherwise pinned lessons and the
    ones still to study. ?q= searches titles and notes."""

    serializer_class = LessonSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    pagination_class = None

    def get_queryset(self):
        qs = Lesson.objects.prefetch_related("files__source", "sources__sentences")
        p = self.request.query_params
        if self.action == "list":
            if p.get("state") == "done":
                qs = qs.filter(done_at__isnull=False).order_by("-done_at")
            else:
                qs = qs.filter(Q(done_at__isnull=True) | Q(pinned=True))
            if p.get("q", "").strip():
                q = p["q"].strip()
                qs = qs.filter(Q(title__icontains=q) | Q(notes__icontains=q) | Q(files__name__icontains=q)).distinct()
        return qs

    def create(self, request):
        """multipart: title, notes and any number of files. The title defaults to the first file's name."""
        files = request.FILES.getlist("files")
        if error := file_error(files):
            return Response({"error": error}, status=400)
        title = request.data.get("title", "").strip() or (Path(files[0].name).stem if files else "")
        serializer = self.get_serializer(data={"title": title, "notes": request.data.get("notes", "")})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lesson = serializer.save()
            add_files(lesson, files)
        return Response(self.get_serializer(lesson).data, status=201)

    def perform_destroy(self, lesson):
        stored = [f.file for f in lesson.files.all()]
        lesson.delete()
        for f in stored:
            f.delete(save=False)

    @action(detail=True, methods=["post"])
    def files(self, request, pk=None):
        lesson = self.get_object()
        files = request.FILES.getlist("files")
        if error := file_error(files, lesson.files.count()):
            return Response({"error": error}, status=400)
        add_files(lesson, files)
        return Response(self.get_serializer(self.get_queryset().get(pk=lesson.pk)).data, status=201)


    @action(detail=True, methods=["post"], url_path=r"files/(?P<fid>\d+)/transcribe")
    def transcribe(self, request, pk=None, fid=None):
        """Copy a recording into the library as a source and queue it for transcription,
        so the lesson can show its transcript. A failed one is queued again."""
        lesson = self.get_object()
        item = get_object_or_404(LessonFile, pk=fid, lesson=lesson)
        if file_kind(item.name) not in ("audio", "video"):
            return Response({"error": "Only recordings and videos can be transcribed."}, status=400)
        from speech import jobs
        source = item.source
        with transaction.atomic():
            if source is None:
                kind = Source.Kind.VIDEO if file_kind(item.name) == "video" else Source.Kind.AUDIO
                # kept, not inbox: it was collected with the lesson, there is nothing to triage
                source = Source.objects.create(kind=kind, status=Source.Status.KEPT, job=Source.Job.WAITING,
                                               title=f"{lesson.title} · {Path(item.name).stem}"[:200])
                with item.file.open("rb") as f:
                    source.media.save(Path(item.name).name, File(f))
                item.source = source
                item.save(update_fields=["source"])
                lesson.sources.add(source)
            elif source.job == Source.Job.FAILED:
                source.job, source.job_error = Source.Job.WAITING, ""
                source.save(update_fields=["job", "job_error"])
            transaction.on_commit(jobs.kick)
        return Response(self.get_serializer(self.get_queryset().get(pk=lesson.pk)).data)


@api_view(["GET", "DELETE"])
def lesson_file(request, pk, fid):
    item = get_object_or_404(LessonFile, pk=fid, lesson_id=pk)
    if request.method == "DELETE":
        item.file.delete(save=False)
        item.delete()
        return Response(status=204)
    if not item.file.storage.exists(item.file.name):
        return Response({"error": "This file is missing from kotoba's data folder."}, status=404)
    resp = ranged_file(request, item.file.path)
    resp["Content-Disposition"] = "inline"
    return resp
