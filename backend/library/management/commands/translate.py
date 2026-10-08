from django.core.management.base import BaseCommand, CommandError
from library import translate
from library.models import Sentence, Source


class Command(BaseCommand):
    help = "Translate sentences that have no translation yet, with the configured LLM."

    def add_arguments(self, parser):
        parser.add_argument("--to", help="language code (default: the one chosen in Add-ons)")
        parser.add_argument("--source", type=int, help="only this source")
        parser.add_argument("--force", action="store_true", help="translate again, replacing existing ones")

    def handle(self, *args, to=None, source=None, force=False, **options):
        lang = to or translate.language()
        if lang not in translate.LANGUAGES:
            raise CommandError(f"Unknown language {lang!r}. Use one of: {', '.join(translate.LANGUAGES)}")
        st = translate.status()
        if not st["ready"]:
            raise CommandError(st["error"])
        qs = Sentence.objects.exclude(source__status=Source.Status.ARCHIVED).select_related("source")
        if source:
            qs = qs.filter(source_id=source)
        if not force:
            qs = qs.filter(**{f"translations__{lang}__isnull": True})
        total = qs.count()
        self.stdout.write(f"Translating {total} sentences into {translate.LANGUAGES[lang]} with {st['model']}"
                          + (" (a cloud service)" if st["cloud"] else "") + ".")
        for n, sentence in enumerate(qs.order_by("source_id", "position").iterator(chunk_size=100), 1):
            try:
                text = translate.translate(sentence, lang, force=force)
            except translate.TranslateError as e:
                raise CommandError(f"Stopped at sentence {sentence.id}: {e}")
            self.stdout.write(f"[{n}/{total}] {sentence.text}\n          {text}")
