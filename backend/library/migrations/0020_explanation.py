from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("library", "0019_note_lesson")]

    operations = [
        migrations.CreateModel(
            name="Explanation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("lang", models.CharField(max_length=8)),
                ("text", models.TextField()),
                ("context", models.TextField(blank=True)),
                ("translation", models.TextField()),
                ("notes", models.JSONField(blank=True, default=list)),
                ("translator", models.CharField(blank=True, max_length=60)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("lang", "text", "context"), name="one_explanation_per_question")],
            },
        ),
    ]
