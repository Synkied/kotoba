from django.db import migrations, models
import django.db.models.deletion


def lesson_notes_to_notes(apps, schema_editor):
    """Each lesson's plain-text notes become a Markdown note kept with the lesson.
    Lesson.notes is left as it was."""
    Lesson, Note = apps.get_model("library", "Lesson"), apps.get_model("library", "Note")
    for lesson in Lesson.objects.exclude(notes=""):
        if not lesson.notes.strip():
            continue
        last = Note.objects.filter(folder=lesson.folder_id).order_by("-position").values_list("position", flat=True).first() or 0
        Note.objects.create(title=lesson.title[:200], body=lesson.notes, folder_id=lesson.folder_id, lesson=lesson, position=last + 1)


class Migration(migrations.Migration):
    dependencies = [("library", "0018_note_links_and_folder")]

    operations = [
        migrations.AddField(
            model_name="note", name="lesson",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="lesson_notes", to="library.lesson"),
        ),
        migrations.RunPython(lesson_notes_to_notes, migrations.RunPython.noop),
    ]
