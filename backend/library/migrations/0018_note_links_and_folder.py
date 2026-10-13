from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("library", "0017_note")]

    operations = [
        migrations.AddField(
            model_name="note", name="folder",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="notes", to="library.lessonfolder"),
        ),
        migrations.AddField(
            model_name="note", name="position", field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="note", name="sources",
            field=models.ManyToManyField(blank=True, related_name="linked_notes", to="library.source"),
        ),
        migrations.AlterModelOptions(name="note", options={"ordering": ["position", "-updated_at", "-id"]}),
    ]
