"""Give everything from before accounts to one user: run once after upgrading, then sign in as them.

Rows nobody owns (sources with their sentences and attempts, decks, words, lessons, folders, files,
notes, explanations) become theirs, the old settings.json in the data folder becomes their
settings (translators, language, YouTube listening) and they follow the channels nobody follows.
Running it again only picks up what is still unowned."""
import json

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from corpus.models import Channel
from library.accounts import command_user
from library.models import Deck, Explanation, Lesson, LessonFolder, Material, Note, Profile, Source, Word, WordUse
from library.translate import _load, _save


class Command(BaseCommand):
    help = "Give everything that has no owner yet (the library from before accounts) to one user."

    def add_arguments(self, parser):
        parser.add_argument("username", nargs="?", help="who gets it (default: the only user)")

    def handle(self, *args, username=None, **kw):
        user = command_user(username)
        with transaction.atomic():
            counts = {model._meta.verbose_name_plural: model.objects.filter(owner=None).update(owner=user)
                      for model in (Source, Deck, LessonFolder, Lesson, Material, Note)}
            counts["words"] = self._words(user)
            counts["explanations"] = self._explanations(user)
            counts["channels followed"] = self._channels(user)
            settings_note = self._settings(user)
        for what, n in counts.items():
            if n:
                self.stdout.write(f"{n} {what}")
        if not any(counts.values()):
            self.stdout.write("Nothing was unowned.")
        if settings_note:
            self.stdout.write(settings_note)
        self.stdout.write(f"All of it is {user.username}'s now.")

    def _words(self, user) -> int:
        """A word the user already has (made since accounts) takes the old one's uses."""
        theirs = dict(Word.objects.filter(owner=user).values_list("key", "id"))
        n = 0
        for old in Word.objects.filter(owner=None):
            if old.key in theirs:
                WordUse.objects.filter(word=old).update(word_id=theirs[old.key])
                if old.known_at:
                    Word.objects.filter(pk=theirs[old.key], known_at=None).update(known_at=old.known_at)
                old.delete()
            else:
                old.owner = user
                old.save(update_fields=["owner"])
            n += 1
        return n

    def _explanations(self, user) -> int:
        n = 0
        for old in Explanation.objects.filter(owner=None):
            if Explanation.objects.filter(owner=user, lang=old.lang, text=old.text, context=old.context).exists():
                old.delete()
            else:
                old.owner = user
                old.save(update_fields=["owner"])
            n += 1
        return n

    def _channels(self, user) -> int:
        nobodys = list(Channel.objects.filter(followers=None))
        user.channels.add(*nobodys)
        return len(nobodys)

    def _settings(self, user) -> str:
        """settings.json from before accounts: its translators join the user's, and what the user
        hasn't chosen since (language, translator in use, YouTube) comes from it."""
        path = settings.DATA_DIR / "settings.json"
        try:
            old = json.loads(path.read_text())
        except (OSError, ValueError):
            return ""
        if not isinstance(old, dict):
            return ""
        Profile.objects.get_or_create(user=user)
        mine = _load(user)
        have = {t.get("id") for t in mine.get("translators", [])}
        merged = {**old, **mine,
                  "translators": [*mine.get("translators", []), *(t for t in old.get("translators", []) if t.get("id") not in have)]}
        _save(user, merged)
        done = path.with_name("settings.json.claimed")
        path.rename(done)  # its keys are in the database now; renamed so a second run doesn't add them again
        return f"Settings and {len(old.get('translators', []))} translator(s) from settings.json (now {done.name})."
