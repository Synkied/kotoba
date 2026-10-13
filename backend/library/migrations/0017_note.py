from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("library", "0016_words")]

    operations = [
        migrations.CreateModel(
            name="Note",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(default="Untitled", max_length=200)),
                ("body", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["-updated_at", "-id"]},
        ),
    ]
