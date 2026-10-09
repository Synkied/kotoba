# Folders and files can be pinned to the top of the library, like lessons.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0012_lessonfile_material'),
    ]

    operations = [
        migrations.AddField(
            model_name='lessonfolder',
            name='pinned',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='material',
            name='pinned',
            field=models.BooleanField(default=False),
        ),
    ]
