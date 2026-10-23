import re

from rest_framework import serializers, viewsets

from .models import Lesson, Note, Source
from .serializers import Owned

# a source mentioned in a note's body: [@今日の会話](/sources/12)
MENTION = re.compile(r"\[@(?:[^\]\\]|\\.)*\]\(/sources/(\d+)\)")


def mentioned(body):
    return {int(pk) for pk in MENTION.findall(body)}


class NoteSourceSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()

    class Meta:
        model = Source
        fields = ["id", "title", "kind"]

    def get_title(self, source):
        return source.title or source.text.strip()[:80] or f"{source.kind.title()} source"


class NoteSerializer(Owned, serializers.ModelSerializer):
    sources = NoteSourceSerializer(many=True, read_only=True)
    source_ids = serializers.PrimaryKeyRelatedField(source="sources", queryset=Source.objects.all(), many=True, write_only=True, required=False)
    lesson = serializers.PrimaryKeyRelatedField(queryset=Lesson.objects.all(), allow_null=True, required=False)
    lesson_title = serializers.CharField(source="lesson.title", read_only=True, default=None)

    class Meta:
        model = Note
        fields = ["id", "title", "body", "folder", "lesson", "lesson_title", "position", "sources", "source_ids", "created_at", "updated_at"]
        read_only_fields = ["id", "position", "created_at", "updated_at"]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give this note a title.")
        return value

    def create(self, data):
        folder = data.get("folder")
        data["position"] = (Note.objects.of(self._user()).filter(folder=folder).order_by("-position").values_list("position", flat=True).first() or 0) + 1
        return self.link_mentions(super().create(data))

    def update(self, note, data):
        if "folder" in data and data["folder"] != note.folder:
            folder = data["folder"]
            data["position"] = (Note.objects.of(self._user()).filter(folder=folder).order_by("-position").values_list("position", flat=True).first() or 0) + 1
        return self.link_mentions(super().update(note, data))

    def link_mentions(self, note):
        """Sources mentioned with @ join the note's links; unlinking stays a deliberate act."""
        missing = mentioned(note.body) - set(note.sources.values_list("id", flat=True))
        if missing:
            note.sources.add(*Source.objects.of(note.owner).filter(pk__in=missing))
            if hasattr(note, "_prefetched_objects_cache"):
                note._prefetched_objects_cache.pop("sources", None)
        return note


class NoteViewSet(viewsets.ModelViewSet):
    """?lesson= lists the notes written for one lesson, oldest first."""

    serializer_class = NoteSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Note.objects.of(self.request.user).select_related("lesson").prefetch_related("sources").order_by("-updated_at", "-id")
        lesson = self.request.query_params.get("lesson", "")
        if self.action == "list" and lesson.isdigit():
            qs = qs.filter(lesson=lesson).order_by("created_at", "id")
        return qs
