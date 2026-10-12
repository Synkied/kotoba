# A bare number (the 1 announcing an exercise) was sent to the translator, which answered
# with the next sentence's translation. Such sentences now translate as themselves.

import re
import unicodedata

from django.db import migrations


def fix(apps, schema_editor):
    Sentence = apps.get_model("library", "Sentence")
    for s in Sentence.objects.exclude(translations={}).only("id", "text", "translations").iterator():
        if not re.search(r"[^\W\d_]", unicodedata.normalize("NFKC", s.text)):
            fixed = {lang: s.text.strip() for lang in s.translations}
            if fixed != s.translations:
                Sentence.objects.filter(pk=s.pk).update(translations=fixed)


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0014_attempt_audio'),
    ]

    operations = [
        migrations.RunPython(fix, migrations.RunPython.noop),
    ]
