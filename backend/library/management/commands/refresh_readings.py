from django.conf import settings
from django.core.management.base import BaseCommand
from library.models import Sentence
from library import romanize


class Command(BaseCommand):
    help = "Regenerate sentence readings and search keys, preserving saved corrections."

    def add_arguments(self, parser):
        parser.add_argument("--if-changed", action="store_true",
                            help="only when the reading engine changed since the last refresh (run at startup)")

    def handle(self, *args, **options):
        stamp = settings.DATA_DIR / "readings-engine"
        engine = romanize.engine()
        if options["if_changed"] and stamp.exists() and stamp.read_text().strip() == engine:
            return
        count = 0
        for sentence in Sentence.objects.iterator(chunk_size=200):
            sentence.save(update_fields=["roman", "furigana", "search"])
            count += 1
        stamp.write_text(engine)
        self.stdout.write(f"Updated {count} sentences with {engine}.")
