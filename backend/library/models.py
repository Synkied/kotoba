from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

import unicodedata

from . import romanize


class OwnedQuerySet(models.QuerySet):
    """Rows belong to one user, directly (owner) or through what they hang from (source__owner):
    Model.objects.of(user) is what that user may see and change."""

    def of(self, user):
        return self.filter(**{self.model.OWNER: user})


def owner_field():
    # nullable: rows from before accounts stay unowned until `manage.py claim_data` gives them to someone
    return models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="+")


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
        STORY = "story"                 # written by an LLM to a syllabus, voiced by TTS (stories.py)

    class Status(models.TextChoices):
        INBOX = "inbox"
        KEPT = "kept"
        ARCHIVED = "archived"

    class Job(models.TextChoices):
        NONE = ""
        WAITING = "waiting"       # needs transcribing on the desktop
        RUNNING = "running"
        FAILED = "failed"

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

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
    # a story's request, how far writing it got, and what its check found (stories.py)
    story = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or self.text[:40]


class Sentence(models.Model):
    """One practisable line, tied to where it came from: a span of the source's audio,
    or the screenshot it was read off."""

    OWNER = "source__owner"
    objects = OwnedQuerySet.as_manager()

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

    # what its words were found with (words.engine()); "" until the word index has read it
    words_engine = models.CharField(max_length=80, blank=True, default="", editable=False, db_index=True)

    class Meta:
        ordering = ["source", "position"]

    def save(self, *args, **kwargs):
        self.text = self.text.strip()
        self.furigana = self.reading_overrides or romanize.furigana(self.text)
        reading_text = romanize.with_readings(self.text, self.reading_overrides) if self.reading_overrides else self.text
        self.roman = romanize.romanize(reading_text)
        self.search = fold(self.text) + "\n" + romanize.key(self.roman.replace("\n", " "))
        fields = kwargs.get("update_fields")
        if fields is None or {"text", "furigana"} & set(fields):
            self.words_engine = ""  # the word index reads it again (practice scores don't change its words)
            if fields is not None:
                kwargs["update_fields"] = [*fields, "words_engine"]
        super().save(*args, **kwargs)

    def __str__(self):
        return self.text


class Deck(models.Model):

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    folder = models.CharField(max_length=80, blank=True)  # decks with the same folder are listed together
    sentences = models.ManyToManyField(Sentence, through="DeckItem", related_name="decks")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class DeckItem(models.Model):

    OWNER = "deck__owner"
    objects = OwnedQuerySet.as_manager()
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

    OWNER = "sentence__source__owner"
    objects = OwnedQuerySet.as_manager()

    sentence = models.ForeignKey(Sentence, related_name="attempts", on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    model = models.CharField(max_length=10, choices=Model.choices, default=Model.NONE)
    overall = models.PositiveSmallIntegerField()
    accuracy = models.PositiveSmallIntegerField()
    clarity = models.PositiveSmallIntegerField()
    fluency = models.PositiveSmallIntegerField()
    said = models.TextField(blank=True)
    units = models.JSONField(default=list, blank=True)
    audio = models.FileField(upload_to="takes/", blank=True)  # the take itself, when you chose to keep it

    class Meta:
        ordering = ["-created_at"]


@receiver(post_delete, sender=Attempt)
def _drop_take(sender, instance, **kwargs):
    # attempts go with their sentence; a kept take goes with them
    if instance.audio:
        instance.audio.delete(save=False)


class Word(models.Model):
    """A word as the dictionary lists it (読む, not 読んで), found in your sentences by the
    word index. Words link sentences across sources; marking one known is yours to do."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    key = models.CharField(max_length=120)  # j:<JMdict id>, or m:<form>/<reading> when it isn't listed
    lemma = models.CharField(max_length=100)
    reading = models.CharField(max_length=100, blank=True)  # hiragana
    entry = models.PositiveIntegerField(null=True, blank=True)  # JMdict id
    search = models.TextField(blank=True, editable=False)  # fold(lemma), the reading and its romaji key
    known_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["lemma"]
        constraints = [models.UniqueConstraint(fields=["owner", "key"], name="one_word_per_key")]

    def save(self, *args, **kwargs):
        roman = romanize.romanize(self.reading) if self.reading else ""
        self.search = "\n".join([fold(self.lemma), fold(self.reading), romanize.key(roman)])
        super().save(*args, **kwargs)

    def __str__(self):
        return self.lemma


class WordUse(models.Model):
    """Where a word stands in a sentence: sentence.text[start:end] is `surface` (読んでいました)."""

    OWNER = "word__owner"
    objects = OwnedQuerySet.as_manager()

    word = models.ForeignKey(Word, related_name="uses", on_delete=models.CASCADE)
    sentence = models.ForeignKey(Sentence, related_name="word_uses", on_delete=models.CASCADE)
    start = models.PositiveIntegerField()
    end = models.PositiveIntegerField()
    surface = models.CharField(max_length=100)

    class Meta:
        ordering = ["sentence", "start"]


class LessonFolder(models.Model):
    """A shelf for lessons, as deep as you like: Minna no Nihongo › Book 1 › Lessons 1–12.
    Folders and lessons keep the order you arrange them in; pinned ones show at the top too."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    name = models.CharField(max_length=80)
    parent = models.ForeignKey("self", related_name="children", null=True, blank=True, on_delete=models.CASCADE)
    pinned = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return self.name


class Lesson(models.Model):
    """Material to study: a worksheet, a textbook chapter, a lesson's recordings, with the
    sources practised from it. Done lessons go to the archive; pinned ones stay at hand."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True)
    pinned = models.BooleanField(default=False)
    folder = models.ForeignKey(LessonFolder, related_name="lessons", null=True, blank=True, on_delete=models.SET_NULL)
    position = models.PositiveIntegerField(default=0)  # order within its folder
    done_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sources = models.ManyToManyField(Source, related_name="lessons", blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return self.title


class Syllabus(models.Model):
    """A course's words and grammar, unit by unit (Minna no Nihongo, lessons 1 to 25), that
    stories are written within. The JLPT levels come with kotoba (stories.JLPT) and aren't rows."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class SyllabusUnit(models.Model):
    """One unit of a syllabus: the words it teaches ([word, reading, meaning]) and its grammar
    ([pattern, note]). A story for unit N may use units 1 to N and features N."""

    OWNER = "syllabus__owner"
    objects = OwnedQuerySet.as_manager()

    syllabus = models.ForeignKey(Syllabus, related_name="units", on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    title = models.CharField(max_length=200, blank=True)
    vocab = models.JSONField(default=list, blank=True)
    grammar = models.JSONField(default=list, blank=True)
    lesson = models.ForeignKey(Lesson, related_name="units", null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["syllabus", "number"]
        constraints = [models.UniqueConstraint(fields=["syllabus", "number"], name="unique_unit_number")]

    def __str__(self):
        return f"{self.syllabus} {self.number}"


class Material(models.Model):
    """A file kept in a folder as it is, not part of any lesson: a textbook PDF, a track,
    a scan. Recordings are transcribed only when asked; pinned ones show at the top too."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    folder = models.ForeignKey(LessonFolder, related_name="materials", null=True, blank=True, on_delete=models.SET_NULL)
    file = models.FileField(upload_to="materials/")
    name = models.CharField(max_length=200)
    pinned = models.BooleanField(default=False)
    size = models.PositiveBigIntegerField(default=0)
    position = models.PositiveIntegerField(default=0)  # order within its folder
    # a recording's transcript: the library source made from a copy of it
    source = models.ForeignKey(Source, related_name="materials", null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class LessonFile(models.Model):
    """A file in a lesson: one uploaded with it, as it came, or one of the folder's materials,
    linked rather than copied. A linked file stays in its folder when the lesson goes."""

    OWNER = "lesson__owner"
    objects = OwnedQuerySet.as_manager()

    lesson = models.ForeignKey(Lesson, related_name="files", on_delete=models.CASCADE)
    file = models.FileField(upload_to="lessons/", blank=True)
    material = models.ForeignKey(Material, related_name="lesson_files", null=True, blank=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    position = models.PositiveIntegerField(default=0)
    # a recording's transcript: the library source made from a copy of it
    source = models.ForeignKey(Source, related_name="lesson_files", null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["position", "id"]


class Note(models.Model):
    """A freeform Markdown page kept in the local library. Sources mentioned in the body as
    [@title](/sources/12) are linked to it as well."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    title = models.CharField(max_length=200, default="Untitled")
    body = models.TextField(blank=True)
    folder = models.ForeignKey(LessonFolder, related_name="notes", null=True, blank=True, on_delete=models.SET_NULL)
    position = models.PositiveIntegerField(default=0)
    sources = models.ManyToManyField(Source, related_name="linked_notes", blank=True)
    # the lesson it was written for; the note outlives the lesson
    lesson = models.ForeignKey(Lesson, related_name="lesson_notes", null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "-updated_at", "-id"]

    def __str__(self):
        return self.title


class Explanation(models.Model):
    """What a selected stretch of Japanese means in its context, as a translator explained it
    into one language. Kept so the same question doesn't cost a second call; Ask again replaces it."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    lang = models.CharField(max_length=8)
    text = models.TextField()
    context = models.TextField(blank=True)
    translation = models.TextField()
    notes = models.JSONField(default=list, blank=True)
    translator = models.CharField(max_length=60, blank=True)  # the one that answered, by name
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "lang", "text", "context"], name="one_explanation_per_question")]


class Profile(models.Model):
    """What each user sets up: the language translations go into, their translators (API keys
    included, never sent back to the browser), whether YouTube listening is on."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    settings = models.JSONField(default=dict, blank=True)


class Conversation(models.Model):
    """A chat with one of the LLMs, kept to read again and carry on. Its turns are kept as the page
    shows them: role, content, the model's name on a reply, and a turn's images as data URLs.
    updated_at moves when a turn is added, not when the chat is renamed or archived."""

    OWNER = "owner"
    owner = owner_field()
    objects = OwnedQuerySet.as_manager()

    title = models.CharField(max_length=200, blank=True)
    messages = models.JSONField(default=list, blank=True)
    pinned = models.BooleanField(default=False)  # held at the top of the history
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-pinned", "-updated_at", "-id"]

    def __str__(self):
        return self.title or "Chat"
