from django.core.management.base import BaseCommand
from library.models import Sentence
from library import romanize


class Command(BaseCommand):
    help = "Regenerate sentence readings and search keys, preserving saved corrections."

    def handle(self, *args, **options):
        count = 0
        for sentence in Sentence.objects.iterator(chunk_size=200):
            sentence.save(update_fields=["roman", "furigana", "search"])
            count += 1
        self.stdout.write(f"Updated {count} sentences with {romanize.engine()}.")
