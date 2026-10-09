# A lesson can link a folder's file instead of keeping its own copy.

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0011_materials'),
    ]

    operations = [
        migrations.AlterField(
            model_name='lessonfile',
            name='file',
            field=models.FileField(blank=True, upload_to='lessons/'),
        ),
        migrations.AddField(
            model_name='lessonfile',
            name='material',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='lesson_files', to='library.material'),
        ),
    ]
