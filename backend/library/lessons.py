"""Lessons: material to study, kept together until it's done. Done lessons leave the
current list for the archive; pinned ones stay at the top whatever their state."""
from pathlib import Path

from django.core.files import File
from django.db import transaction
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .models import Lesson, LessonFile, LessonFolder, Material, Source
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


def add_files(lesson, files, materials=()):
    """Uploads, then folder files in the order chosen; a folder file already in the lesson is skipped."""
    start = lesson.files.count()
    for i, f in enumerate(files):
        LessonFile.objects.create(lesson=lesson, file=f, name=Path(f.name).name[:200], position=start + i)
    linked = set(lesson.files.values_list("material_id", flat=True))
    start += len(files)
    for m in materials:
        if m.pk not in linked:
            LessonFile.objects.create(lesson=lesson, material=m, name=m.name, position=start)
            linked.add(m.pk)
            start += 1


def chosen_materials(request):
    """The folder files picked for a lesson, in the order they were picked."""
    ids = [int(x) for x in request.data.getlist("materials") if str(x).isdigit()] if hasattr(request.data, "getlist") \
        else [int(x) for x in request.data.get("materials", [])]
    found = Material.objects.in_bulk(ids)
    return [found[i] for i in ids if i in found]


def stored(item):
    """Where a lesson file's bytes and transcript live: its own, or its folder file's."""
    return item.material or item


def next_position(qs):
    return (qs.aggregate(m=Max("position"))["m"] or 0) + 1


class LessonFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonFolder
        fields = ["id", "name", "parent", "position", "pinned"]
        read_only_fields = ["position"]

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Give the folder a name.")
        return value

    def validate_parent(self, parent):
        # not into itself, nor into a folder inside it
        at = parent
        while self.instance and at:
            if at.pk == self.instance.pk:
                raise serializers.ValidationError("A folder can't go inside itself.")
            at = at.parent
        return parent

    def create(self, data):
        data["position"] = next_position(LessonFolder.objects.filter(parent=data.get("parent")))
        return super().create(data)

    def update(self, folder, data):
        if "parent" in data and data["parent"] != folder.parent:
            data["position"] = next_position(LessonFolder.objects.filter(parent=data["parent"]))
        return super().update(folder, data)


class LessonFolderViewSet(viewsets.ModelViewSet):
    """Every folder at once, flat: the tree is small, and the page builds it from the parents."""

    serializer_class = LessonFolderSerializer
    queryset = LessonFolder.objects.all()
    http_method_names = ["get", "post", "patch", "delete"]
    pagination_class = None

    def perform_destroy(self, folder):
        """What the folder held moves up to its parent, after what's already there: deleting a
        folder never deletes a lesson or a file."""
        with transaction.atomic():
            start = next_position(Lesson.objects.filter(folder=folder.parent))
            for i, lesson in enumerate(folder.lessons.all()):
                lesson.folder, lesson.position = folder.parent, start + i
                lesson.save(update_fields=["folder", "position"])
            start = next_position(Material.objects.filter(folder=folder.parent))
            for i, item in enumerate(folder.materials.all()):
                item.folder, item.position = folder.parent, start + i
                item.save(update_fields=["folder", "position"])
            start = next_position(LessonFolder.objects.filter(parent=folder.parent))
            for i, child in enumerate(folder.children.all()):
                child.parent, child.position = folder.parent, start + i
                child.save(update_fields=["parent", "position"])
            folder.delete()


@api_view(["POST"])
def arrange_lessons(request):
    """{folder, folders, lessons, materials: [ids]}: put these in that folder (null: the top),
    in this order. Moving and reordering are the same thing."""
    folder_id = request.data.get("folder")
    folder = get_object_or_404(LessonFolder, pk=folder_id) if folder_id is not None else None
    folders = list(LessonFolder.objects.filter(pk__in=request.data.get("folders", [])))
    lessons = list(Lesson.objects.filter(pk__in=request.data.get("lessons", [])))
    materials = list(Material.objects.filter(pk__in=request.data.get("materials", [])))
    order = {"f": {int(x): i for i, x in enumerate(request.data.get("folders", []))},
             "l": {int(x): i for i, x in enumerate(request.data.get("lessons", []))},
             "m": {int(x): i for i, x in enumerate(request.data.get("materials", []))}}
    for f in folders:
        at = folder
        while at:
            if at.pk == f.pk:
                return Response({"error": f"“{f.name}” can't go inside itself."}, status=400)
            at = at.parent
    with transaction.atomic():
        for f in folders:
            f.parent, f.position = folder, order["f"][f.pk] + 1
            f.save(update_fields=["parent", "position"])
        for l in lessons:
            l.folder, l.position = folder, order["l"][l.pk] + 1
            l.save(update_fields=["folder", "position"])
        for m in materials:
            m.folder, m.position = folder, order["m"][m.pk] + 1
            m.save(update_fields=["folder", "position"])
    return Response(status=204)


class LessonSerializer(serializers.ModelSerializer):
    done = serializers.BooleanField(write_only=True, required=False)
    sources = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Source.objects.all())

    class Meta:
        model = Lesson
        fields = ["id", "title", "notes", "folder", "position", "pinned", "done", "done_at", "created_at", "sources"]
        read_only_fields = ["position", "done_at", "created_at"]

    def validate_title(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Give the lesson a title.")
        return value

    def create(self, data):
        # a new lesson goes at the end of its folder
        data["position"] = next_position(Lesson.objects.filter(folder=data.get("folder")))
        return super().create(data)

    def update(self, lesson, data):
        if "folder" in data and data["folder"] != lesson.folder:
            data["position"] = next_position(Lesson.objects.filter(folder=data["folder"]))
        if "done" in data:
            done = data.pop("done")
            if done != (lesson.done_at is not None):
                lesson.done_at = timezone.now() if done else None
        return super().update(lesson, data)

    def to_representation(self, lesson):
        out = super().to_representation(lesson)
        out["files"] = [{"id": f.id, "name": f.name, "kind": file_kind(f.name),
                         "url": f"/api/lessons/{lesson.id}/files/{f.id}", "material": f.material_id,
                         "source": stored(f).source_id, "job": stored(f).source.job if stored(f).source else None,
                         "job_error": stored(f).source.job_error if stored(f).source else ""} for f in lesson.files.all()]
        out["sources"] = [{"id": s.id, "title": str(s) or "Untitled", "kind": s.kind, "status": s.status,
                           "sentences": len(s.sentences.all()), "job": s.job,
                           "media": f"/api/sources/{s.id}/media" if s.media else None} for s in lesson.sources.all()]
        from speech import jobs
        out["can_transcribe"] = jobs.can_transcribe()
        return out


def transcribe(item, title):
    """Copy a recording (a lesson file or a material) into the library as a source and queue
    it for transcription. A failed one is queued again. True when the source is new."""
    from speech import jobs
    source, made = item.source, False
    if source is None:
        kind = Source.Kind.VIDEO if file_kind(item.name) == "video" else Source.Kind.AUDIO
        # kept, not inbox: it was collected on purpose, there is nothing to triage
        source = Source.objects.create(kind=kind, status=Source.Status.KEPT, job=Source.Job.WAITING, title=title[:200])
        with item.file.open("rb") as f:
            source.media.save(Path(item.name).name, File(f))
        item.source, made = source, True
        item.save(update_fields=["source"])
    elif source.job == Source.Job.FAILED:
        source.job, source.job_error = Source.Job.WAITING, ""
        source.save(update_fields=["job", "job_error"])
    transaction.on_commit(jobs.kick)
    return made


class LessonViewSet(viewsets.ModelViewSet):
    """?state=done is the archive, newest done first; otherwise pinned lessons and the
    ones still to study. ?q= searches titles, notes, folders and file names."""

    serializer_class = LessonSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    pagination_class = None

    def get_queryset(self):
        qs = Lesson.objects.prefetch_related("files__source", "files__material__source", "sources__sentences")
        p = self.request.query_params
        if self.action == "list":
            if p.get("state") == "done":
                qs = qs.filter(done_at__isnull=False).order_by("-done_at")
            else:
                qs = qs.filter(Q(done_at__isnull=True) | Q(pinned=True))
            if p.get("q", "").strip():
                q = p["q"].strip()
                qs = qs.filter(Q(title__icontains=q) | Q(notes__icontains=q) | Q(folder__name__icontains=q) | Q(files__name__icontains=q)).distinct()
        return qs

    def create(self, request):
        """multipart: title, notes, folder, any number of files to upload and the ids of folder
        files (materials) to link. The title defaults to the first file's name."""
        files, materials = request.FILES.getlist("files"), chosen_materials(request)
        if error := file_error(files, len(materials)):
            return Response({"error": error}, status=400)
        first = files[0].name if files else materials[0].name if materials else ""
        title = request.data.get("title", "").strip() or Path(first).stem
        serializer = self.get_serializer(data={"title": title, "notes": request.data.get("notes", ""),
                                               "folder": request.data.get("folder") or None})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lesson = serializer.save()
            add_files(lesson, files, materials)
        return Response(self.get_serializer(lesson).data, status=201)

    def perform_destroy(self, lesson):
        # files linked from a folder stay there
        own = [f.file for f in lesson.files.all() if not f.material_id]
        lesson.delete()
        for f in own:
            f.delete(save=False)

    @action(detail=True, methods=["post"])
    def files(self, request, pk=None):
        """multipart or JSON: files to upload and/or the ids of folder files to link."""
        lesson = self.get_object()
        files, materials = request.FILES.getlist("files"), chosen_materials(request)
        if error := file_error(files, lesson.files.count() + len(materials)):
            return Response({"error": error}, status=400)
        add_files(lesson, files, materials)
        return Response(self.get_serializer(self.get_queryset().get(pk=lesson.pk)).data, status=201)


    @action(detail=True, methods=["post"], url_path=r"files/(?P<fid>\d+)/transcribe")
    def transcribe(self, request, pk=None, fid=None):
        """Copy a recording into the library as a source and queue it for transcription,
        so the lesson can show its transcript. A failed one is queued again."""
        lesson = self.get_object()
        item = get_object_or_404(LessonFile, pk=fid, lesson=lesson)
        if file_kind(item.name) not in ("audio", "video"):
            return Response({"error": "Only recordings and videos can be transcribed."}, status=400)
        with transaction.atomic():
            transcribe(stored(item), f"{lesson.title} · {Path(item.name).stem}")
            lesson.sources.add(stored(item).source)
        return Response(self.get_serializer(self.get_queryset().get(pk=lesson.pk)).data)


@api_view(["GET", "DELETE"])
def lesson_file(request, pk, fid):
    item = get_object_or_404(LessonFile.objects.select_related("material"), pk=fid, lesson_id=pk)
    if request.method == "DELETE":
        # taken out of the lesson; a folder file stays in its folder
        if not item.material_id:
            item.file.delete(save=False)
        item.delete()
        return Response(status=204)
    file = stored(item).file
    if not file or not file.storage.exists(file.name):
        return Response({"error": "This file is missing from kotoba's data folder."}, status=404)
    resp = ranged_file(request, file.path)
    resp["Content-Disposition"] = "inline"
    return resp


class MaterialSerializer(serializers.ModelSerializer):
    class Meta:
        model = Material
        fields = ["id", "name", "folder", "position", "pinned", "size", "created_at"]
        read_only_fields = ["position", "size", "created_at"]

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Give the file a name.")
        return value

    def update(self, item, data):
        if "folder" in data and data["folder"] != item.folder:
            data["position"] = next_position(Material.objects.filter(folder=data["folder"]))
        return super().update(item, data)

    def to_representation(self, item):
        out = super().to_representation(item)
        out.update(kind=file_kind(item.name), url=f"/api/materials/{item.id}/file", source=item.source_id,
                   lessons=[{"id": f.lesson_id, "title": f.lesson.title} for f in item.lesson_files.all()],
                   job=item.source.job if item.source else None, job_error=item.source.job_error if item.source else "")
        return out


class MaterialViewSet(viewsets.ModelViewSet):
    """Files kept in folders as they are. All of them at once, flat: the page sorts them into
    the folder tree. POST is multipart: any number of files and the folder they go in."""

    serializer_class = MaterialSerializer
    queryset = Material.objects.select_related("source").prefetch_related("lesson_files__lesson")
    http_method_names = ["get", "post", "patch", "delete"]
    pagination_class = None

    def create(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"error": "Choose the files to add."}, status=400)
        for f in files:
            if Path(f.name).suffix.lower() not in ALLOWED_EXT:
                return Response({"error": f"{f.name}: folders keep PDFs, audio, video, images and text files."}, status=400)
            if not f.size:
                return Response({"error": f"{f.name} is empty. Choose the original file again."}, status=400)
        folder_id = request.data.get("folder") or None
        folder = get_object_or_404(LessonFolder, pk=folder_id) if folder_id else None
        with transaction.atomic():
            start = next_position(Material.objects.filter(folder=folder))
            made = [Material.objects.create(folder=folder, file=f, name=Path(f.name).name[:200], size=f.size, position=start + i)
                    for i, f in enumerate(files)]
        return Response(self.get_serializer(made, many=True).data, status=201)

    def perform_destroy(self, item):
        item.file.delete(save=False)
        item.delete()

    @action(detail=True)
    def file(self, request, pk=None):
        item = self.get_object()
        if not item.file.storage.exists(item.file.name):
            return Response({"error": "This file is missing from kotoba's data folder."}, status=404)
        resp = ranged_file(request, item.file.path)
        resp["Content-Disposition"] = "inline"
        return resp

    @action(detail=False, methods=["post"])
    def transcribe(self, request):
        """{ids}: queue these recordings for transcription, each into its own library source.
        What isn't a recording is left alone."""
        items = [m for m in self.get_queryset().filter(pk__in=request.data.get("ids", []))
                 if file_kind(m.name) in ("audio", "video")]
        if not items:
            return Response({"error": "Choose recordings or videos to transcribe."}, status=400)
        with transaction.atomic():
            for item in items:
                transcribe(item, Path(item.name).stem)
        return Response(self.get_serializer(self.get_queryset().filter(pk__in=[m.pk for m in items]), many=True).data)
