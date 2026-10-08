from django.db import models
from django.utils import timezone

import unicodedata

from . import romanize


def fold(text: str) -> str:
    """Full/half width, katakana/hiragana and case all match each other."""
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(chr(ord(ch) - 0x60) if "ァ" <= ch <= "ヶ" else ch for ch in text)


class Source(models.Model):
    """Something collected: a screen capture, a recording, a video, a subtitle file or
    pasted text. Its sentences are what gets practised."""

    class Kind(models.TextChoices):
        CAPTURE = "capture"
        AUDIO = "audio"
        VIDEO = "video"
        SUBTITLE = "subtitle"
        TEXT = "text"

    class Status(models.TextChoices):
        INBOX = "inbox"
        KEPT = "kept"
        ARCHIVED = "archived"

    class Job(models.TextChoices):
        NONE = ""
        WAITING = "waiting"       # needs transcribing on the desktop
        RUNNING = "running"
        FAILED = "failed"

    kind = models.CharField(max_length=10, choices=Kind.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.INBOX)
    title = models.CharField(max_length=200, blank=True)
    text = models.TextField(blank=True)               # the raw text as it came in
    category = models.CharField(max_length=40, blank=True)
    labels = models.JSONField(default=list, blank=True)
    image = models.FileField(upload_to="images/", blank=True)
    media = models.FileField(upload_to="media/", blank=True)
    duration = models.FloatField(null=True, blank=True)
    job = models.CharField(max_length=10, choices=Job.choices, default=Job.NONE, blank=True)
    job_error = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or self.text[:40]


class Sentence(models.Model):
    """One practisable line, tied to where it came from: a span of the source's audio,
    or the screenshot it was read off."""

    source = models.ForeignKey(Source, related_name="sentences", on_delete=models.CASCADE)
    position = models.PositiveIntegerField(default=0)
    text = models.TextField()
    roman = models.TextField(blank=True)              # Latin reading, shown under the text
    search = models.TextField(blank=True, editable=False)  # fold(text) + reading key
    furigana = models.JSONField(default=list, blank=True)
    reading_overrides = models.JSONField(default=list, blank=True)
    start = models.FloatField(null=True, blank=True)  # seconds into source.media
    end = models.FloatField(null=True, blank=True)
    note = models.TextField(blank=True)
    translations = models.JSONField(default=dict, blank=True)  # {"en": "...", "fr": "..."}
    created_at = models.DateTimeField(default=timezone.now)

    # spaced review (SM-2 style, fed by practice scores)
    due = models.DateTimeField(null=True, blank=True, db_index=True)
    interval = models.FloatField(default=0)           # days
    ease = models.FloatField(default=2.5)
    reps = models.PositiveIntegerField(default=0)
    lapses = models.PositiveIntegerField(default=0)
    best = models.PositiveSmallIntegerField(null=True, blank=True)
    last = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["source", "position"]

    def save(self, *args, **kwargs):
        self.text = self.text.strip()
        self.furigana = self.reading_overrides or romanize.furigana(self.text)
        reading_text = romanize.with_readings(self.text, self.reading_overrides) if self.reading_overrides else self.text
        self.roman = romanize.romanize(reading_text)
        self.search = fold(self.text) + "\n" + romanize.key(self.roman.replace("\n", " "))
        super().save(*args, **kwargs)

    def __str__(self):
        return self.text


class Deck(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    sentences = models.ManyToManyField(Sentence, through="DeckItem", related_name="decks")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class DeckItem(models.Model):
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="items")
    sentence = models.ForeignKey(Sentence, on_delete=models.CASCADE)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["deck", "sentence"], name="deck_sentence_once")]


class Attempt(models.Model):
    """One scored try at saying a sentence. Attempts are never edited or removed."""

    class Model(models.TextChoices):
        NATIVE = "native"
        TTS = "tts"
        NONE = "none"

    sentence = models.ForeignKey(Sentence, related_name="attempts", on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    model = models.CharField(max_length=10, choices=Model.choices, default=Model.NONE)
    overall = models.PositiveSmallIntegerField()
    accuracy = models.PositiveSmallIntegerField()
    clarity = models.PositiveSmallIntegerField()
    fluency = models.PositiveSmallIntegerField()
    said = models.TextField(blank=True)
    units = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at"]


class ListeningLesson(models.Model):
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    pdf = models.FileField(upload_to="listening/")
    pages = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["id"]


class ListeningExercise(models.Model):
    lesson = models.ForeignKey(ListeningLesson, related_name="exercises", on_delete=models.CASCADE)
    position = models.PositiveIntegerField()
    title = models.CharField(max_length=200)
    instructions = models.TextField()
    example = models.TextField(blank=True)
    audio = models.FileField(upload_to="listening/")
    image = models.FileField(upload_to="listening/", blank=True)
    image_alt = models.TextField(blank=True)
    questions = models.JSONField(default=list)
    worksheet_page = models.PositiveIntegerField(default=1)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["lesson", "position"], name="listening_lesson_position")]


class ListeningAttempt(models.Model):
    exercise = models.ForeignKey(ListeningExercise, related_name="attempts", on_delete=models.CASCADE)
    responses = models.JSONField()
    feedback = models.JSONField(default=list)
    score = models.PositiveIntegerField(null=True)
    total = models.PositiveIntegerField()
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
