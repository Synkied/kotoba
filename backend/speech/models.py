from django.db import models

from library.models import Source


class Cleanup(models.Model):
    """The recording editor's state for one audio/video source: Whisper's words (shared
    with transcription, so the editor never transcribes twice), the analysis settings,
    the script that was read, the cut list as last edited and the rendered result."""

    source = models.OneToOneField(Source, primary_key=True, related_name="cleanup", on_delete=models.CASCADE)
    words = models.JSONField(null=True, blank=True)       # {model, duration, words: [{word, start, end}]}
    settings = models.JSONField(default=dict, blank=True)
    script = models.TextField(blank=True)
    cuts = models.JSONField(null=True, blank=True)        # [{start, end, reason, on}]; None = not edited
    peaks = models.JSONField(null=True, blank=True)
    clean = models.FileField(upload_to="clean/", blank=True)
    rendered_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"cleanup of {self.source}"
