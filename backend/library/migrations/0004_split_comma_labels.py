from django.db import migrations


def split(apps, schema_editor):
    """Labels added from the library used to keep "a, b" as one label; split them."""
    from library.serializers import LABEL_SEP, split_labels
    Source = apps.get_model("library", "Source")
    for s in Source.objects.all().only("id", "labels"):
        if any(LABEL_SEP.search(str(label)) for label in s.labels or []):
            # keep every part, even past the three-label limit, so nothing typed is lost
            seen, out = set(), []
            for label in (" ".join(x.split())[:40] for x in split_labels(s.labels)):
                if label and label.lower() not in seen:
                    seen.add(label.lower())
                    out.append(label)
            s.labels = out
            s.save(update_fields=["labels"])


class Migration(migrations.Migration):

    dependencies = [
        ("library", "0003_listeningexercise_listeninglesson_listeningattempt_and_more"),
    ]

    operations = [migrations.RunPython(split, migrations.RunPython.noop)]
