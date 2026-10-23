"""Heard elsewhere: the subtitled lines of YouTube channels you follow, kept apart from your own
sentences. A line becomes one of yours only when you keep it (corpus.keep), so the library, the
word list and review never fill up with lines you didn't choose."""

from django.db import models
from django.utils import timezone

from library.models import Sentence, Source, fold


class Channel(models.Model):
    """A channel or playlist you follow, or the videos found by searching YouTube for a word."""

    class Kind(models.TextChoices):
        CHANNEL = "channel"
        PLAYLIST = "playlist"
        SEARCH = "search"       # "Find more" on a word page: one per word searched

    kind = models.CharField(max_length=10, choices=Kind.choices)
    url = models.CharField(max_length=500, unique=True)
    title = models.CharField(max_length=200, blank=True)
    term_key = models.CharField(max_length=120, blank=True)  # SEARCH: the word it was searched for
    error = models.TextField(blank=True)
    added_at = models.DateTimeField(default=timezone.now)
    checked_at = models.DateTimeField(null=True, blank=True)  # its video list last read

    class Meta:
        ordering = ["added_at"]

    def __str__(self):
        return self.title or self.url


class Video(models.Model):
    class Subs(models.TextChoices):
        WAITING = "waiting"     # not looked at yet
        OK = "ok"               # human-made Japanese subtitles, read into lines
        NONE = "none"           # only automatic captions, or none
        MEMBERS = "members"     # members-only, private or otherwise out of reach
        FAILED = "failed"

    yt_id = models.CharField(max_length=20, unique=True)
    channels = models.ManyToManyField(Channel, related_name="videos")
    title = models.CharField(max_length=300, blank=True)
    uploader = models.CharField(max_length=200, blank=True)
    duration = models.FloatField(null=True, blank=True)
    published = models.DateField(null=True, blank=True)
    subs = models.CharField(max_length=10, choices=Subs.choices, default=Subs.WAITING, db_index=True)
    error = models.TextField(blank=True)
    gone_at = models.DateTimeField(null=True, blank=True)  # private or deleted since
    source = models.OneToOneField(Source, null=True, blank=True, on_delete=models.SET_NULL, related_name="video")
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-published", "-id"]

    def url(self, at: float | None = None) -> str:
        return f"https://www.youtube.com/watch?v={self.yt_id}" + (f"&t={int(at)}s" if at else "")

    def __str__(self):
        return self.title or self.yt_id


class Line(models.Model):
    """One subtitle cue: what was said between start and end."""

    video = models.ForeignKey(Video, related_name="lines", on_delete=models.CASCADE)
    position = models.PositiveIntegerField()
    text = models.TextField()
    start = models.FloatField()
    end = models.FloatField()
    furigana = models.JSONField(default=list, blank=True)
    words_engine = models.CharField(max_length=80, blank=True, default="", db_index=True)
    sentence = models.ForeignKey(Sentence, null=True, blank=True, on_delete=models.SET_NULL, related_name="heard_lines")

    class Meta:
        ordering = ["video", "position"]
        constraints = [models.UniqueConstraint(fields=["video", "position"], name="corpus_line_position")]

    def __str__(self):
        return self.text


class Term(models.Model):
    """A word as the dictionary lists it, found in corpus lines. The same key as library.Word
    (j:<JMdict id>, or m:<form>/<reading>), but a term isn't a word you've met."""

    key = models.CharField(max_length=120, unique=True)
    lemma = models.CharField(max_length=100)
    reading = models.CharField(max_length=100, blank=True)
    entry = models.PositiveIntegerField(null=True, blank=True)
    search = models.TextField(blank=True, editable=False)

    @staticmethod
    def searchable(lemma: str, reading: str) -> str:
        """fold(lemma), the reading and its romaji key, as library.Word keeps them."""
        from library import romanize
        roman = romanize.romanize(reading) if reading else ""
        return "\n".join([fold(lemma), fold(reading), romanize.key(roman)])

    def save(self, *args, **kwargs):
        self.search = self.searchable(self.lemma, self.reading)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.lemma


class TermUse(models.Model):
    """line.text[start:end] is `surface`, a form of `term`."""

    term = models.ForeignKey(Term, related_name="uses", on_delete=models.CASCADE)
    line = models.ForeignKey(Line, related_name="uses", on_delete=models.CASCADE)
    start = models.PositiveIntegerField()
    end = models.PositiveIntegerField()
    surface = models.CharField(max_length=100)

    class Meta:
        ordering = ["line", "start"]
