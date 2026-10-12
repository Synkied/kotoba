# A take can be kept with its score, to hear again later.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0013_pinned_folders_and_materials'),
    ]

    operations = [
        migrations.AddField(
            model_name='attempt',
            name='audio',
            field=models.FileField(blank=True, upload_to='takes/'),
        ),
    ]
