from rest_framework import serializers

from .models import Attempt, Deck, Sentence, Source

MAX_LABELS = 3


def clean_labels(value):
    seen, out = set(), []
    for label in value or []:
        label = str(label).strip()[:40]
        if label and label.lower() not in seen:
            seen.add(label.lower())
            out.append(label)
    return out[:MAX_LABELS]


class StampSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attempt
        fields = ["id", "created_at", "overall", "accuracy", "clarity", "fluency", "model"]


class SentenceSerializer(serializers.ModelSerializer):
    source_kind = serializers.CharField(source="source.kind", read_only=True)
    source_title = serializers.SerializerMethodField()
    has_audio = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    stamps = serializers.SerializerMethodField()
    decks = serializers.SerializerMethodField()

    class Meta:
        model = Sentence
        fields = ["id", "source", "source_kind", "source_title", "position", "text", "roman", "furigana",
                  "start", "end", "note", "has_audio", "image", "due", "reps", "lapses", "best", "last",
                  "stamps", "decks", "created_at"]
        read_only_fields = ["roman", "furigana", "due", "reps", "lapses", "best", "last", "created_at"]

    def get_source_title(self, s):
        return str(s.source)

    def get_has_audio(self, s):
        return bool(s.source.media) and s.start is not None

    def get_image(self, s):
        return s.source.image.url if s.source.image else None

    def get_stamps(self, s):
        return StampSerializer(s.attempts.all()[:6], many=True).data

    def get_decks(self, s):
        return [{"id": d.id, "name": d.name} for d in s.decks.all()]


class SourceSerializer(serializers.ModelSerializer):
    sentences = SentenceSerializer(many=True, read_only=True)
    image = serializers.SerializerMethodField()
    media = serializers.SerializerMethodField()

    class Meta:
        model = Source
        fields = ["id", "kind", "status", "title", "text", "category", "labels", "image", "media",
                  "duration", "job", "job_error", "created_at", "sentences"]
        read_only_fields = ["kind", "image", "media", "duration", "job", "job_error", "created_at"]

    def get_image(self, s):
        return s.image.url if s.image else None

    def get_media(self, s):
        return f"/api/sources/{s.id}/media" if s.media else None

    def validate_labels(self, value):
        return clean_labels(value)


class DeckSerializer(serializers.ModelSerializer):
    size = serializers.IntegerField(read_only=True)
    due = serializers.IntegerField(read_only=True)
    practised = serializers.IntegerField(read_only=True)
    average = serializers.FloatField(read_only=True)

    class Meta:
        model = Deck
        fields = ["id", "name", "description", "created_at", "size", "due", "practised", "average"]


class AttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attempt
        fields = ["id", "sentence", "created_at", "model", "overall", "accuracy", "clarity", "fluency",
                  "said", "units"]
        read_only_fields = ["created_at"]
