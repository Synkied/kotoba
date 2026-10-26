import re

from rest_framework import serializers

from .models import Attempt, Deck, Sentence, Source

MAX_LABELS = 3


# Labels are typed as one comma-separated line; accept Japanese and full-width commas too.
LABEL_SEP = re.compile(r"[,、，､]")


def split_labels(value):
    if isinstance(value, str):
        value = [value]
    return [part for label in value or [] for part in LABEL_SEP.split(str(label))]


def clean_labels(value):
    seen, out = set(), []
    for label in split_labels(value):
        label = " ".join(label.split())[:40]
        if label and label.lower() not in seen:
            seen.add(label.lower())
            out.append(label)
    return out[:MAX_LABELS]


class Owned:
    """For a serializer of a user's rows: what its fields can point at (a folder, a source, a
    sentence) is limited to that user's own, and a row it makes is theirs. Needs the request in
    its context to write; without one, related fields accept nothing."""

    def _user(self):
        request = self.context.get("request")
        return request.user if request and request.user.is_authenticated else None

    def get_fields(self):
        fields = super().get_fields()
        user = self._user()
        for field in fields.values():
            rel = getattr(field, "child_relation", field)
            qs = getattr(rel, "queryset", None)
            if qs is not None and hasattr(qs, "of"):
                rel.queryset = qs.of(user) if user else qs.none()
        return fields

    def create(self, data):
        if hasattr(self.Meta.model, "owner"):
            data["owner"] = self._user()
        return super().create(data)


def take_url(a):
    return a.audio.url if a.audio else None


class StampSerializer(serializers.ModelSerializer):
    audio = serializers.SerializerMethodField()

    class Meta:
        model = Attempt
        fields = ["id", "created_at", "overall", "accuracy", "clarity", "fluency", "model", "audio"]

    def get_audio(self, a):
        return take_url(a)


class SentenceSerializer(Owned, serializers.ModelSerializer):
    source_kind = serializers.CharField(source="source.kind", read_only=True)
    source_title = serializers.SerializerMethodField()
    has_audio = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    stamps = serializers.SerializerMethodField()
    decks = serializers.SerializerMethodField()

    class Meta:
        model = Sentence
        fields = ["id", "source", "source_kind", "source_title", "position", "text", "roman", "furigana",
                  "reading_overrides", "start", "end", "note", "translations", "has_audio", "image", "due", "reps", "lapses", "best", "last",
                  "stamps", "decks", "created_at"]
        read_only_fields = ["roman", "furigana", "due", "reps", "lapses", "best", "last", "created_at"]

    def validate(self, attrs):
        from . import romanize
        text = attrs.get("text", self.instance.text if self.instance else "").strip()
        pairs = attrs.get("reading_overrides")
        if pairs is not None and not isinstance(pairs, list):
            raise serializers.ValidationError({"reading_overrides": "Readings must be a list."})
        if pairs:
            expected = [p[0] for p in romanize.furigana(text)]
            if not isinstance(pairs, list) or len(pairs) != len(expected):
                raise serializers.ValidationError({"reading_overrides": "Supply one reading for each generated furigana span."})
            for pair, surface in zip(pairs, expected):
                if (not isinstance(pair, list) or len(pair) != 2 or pair[0] != surface
                        or not isinstance(pair[1], str) or not pair[1]
                        or len(pair[1]) > 100 or any(not ("ぁ" <= c <= "ゖ" or c == "ー") for c in pair[1])):
                    raise serializers.ValidationError({"reading_overrides": "Readings must be hiragana and match the sentence spans in order."})
        if self.instance and text != self.instance.text and pairs is None:
            attrs["reading_overrides"] = []
        if "translations" in attrs:
            from .translate import LANGUAGES
            given = attrs["translations"]
            if not isinstance(given, dict) or any(k not in LANGUAGES or not isinstance(v, str) or len(v) > 2000
                                                   for k, v in given.items()):
                raise serializers.ValidationError({"translations": "Translations map a language code to text."})
            attrs["translations"] = {k: v.strip() for k, v in given.items() if v.strip()}
        elif self.instance and text != self.instance.text:
            attrs["translations"] = {}  # they translated the old text
        return attrs

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


class SourceSerializer(Owned, serializers.ModelSerializer):
    sentences = SentenceSerializer(many=True, read_only=True)
    image = serializers.SerializerMethodField()
    media = serializers.SerializerMethodField()
    lessons = serializers.SerializerMethodField()
    story = serializers.SerializerMethodField()

    class Meta:
        model = Source
        fields = ["id", "kind", "status", "title", "text", "category", "labels", "image", "media",
                  "duration", "job", "job_error", "created_at", "sentences", "lessons", "story"]
        read_only_fields = ["kind", "image", "media", "duration", "job", "job_error", "created_at"]

    def get_image(self, s):
        return s.image.url if s.image else None

    def get_media(self, s):
        return f"/api/sources/{s.id}/media" if s.media else None

    def get_lessons(self, s):
        """the lessons this source is studied in, so its page can lead back to them"""
        return [{"id": l.id, "title": l.title, "done": l.done_at is not None} for l in s.lessons.all()]

    def get_story(self, s):
        if s.kind != Source.Kind.STORY:
            return None
        from .stories import public
        return public(s)

    def validate_labels(self, value):
        return clean_labels(value)


class DeckSerializer(Owned, serializers.ModelSerializer):
    size = serializers.IntegerField(read_only=True)
    due = serializers.IntegerField(read_only=True)
    practised = serializers.IntegerField(read_only=True)
    average = serializers.FloatField(read_only=True)

    class Meta:
        model = Deck
        fields = ["id", "name", "description", "folder", "created_at", "size", "due", "practised", "average"]

    def validate_folder(self, value):
        return " ".join(value.split())


class AttemptSerializer(Owned, serializers.ModelSerializer):
    audio = serializers.SerializerMethodField()

    class Meta:
        model = Attempt
        fields = ["id", "sentence", "created_at", "model", "overall", "accuracy", "clarity", "fluency",
                  "said", "units", "audio"]
        read_only_fields = ["created_at"]

    def get_audio(self, a):
        return take_url(a)
