from django.core.management.base import BaseCommand
from library import dictionary


class Command(BaseCommand):
    help = "Download JMdict (KOTOBA_DICT_LANG, default eng) and index it for word lookups."

    def add_arguments(self, parser):
        parser.add_argument("--file", help="index a jmdict-simplified JSON file you already have instead")

    def handle(self, *args, file=None, **options):
        progress = lambda p: self.stdout.write(p if isinstance(p, str) else f"  {p} entries")
        count = dictionary.build(file, progress=progress) if file else dictionary.download(progress=progress)
        self.stdout.write(f"Indexed {count} entries into {dictionary.path()}.")
