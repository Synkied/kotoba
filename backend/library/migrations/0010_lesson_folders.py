# Folders for lessons, nested, and the order you arrange lessons in.

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0009_lesson_file_source'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='lesson',
            options={'ordering': ['position', 'created_at']},
        ),
        migrations.AddField(
            model_name='lesson',
            name='position',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name='LessonFolder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80)),
                ('position', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='library.lessonfolder')),
            ],
            options={
                'ordering': ['position', 'created_at'],
            },
        ),
        migrations.AddField(
            model_name='lesson',
            name='folder',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='lessons', to='library.lessonfolder'),
        ),
    ]
