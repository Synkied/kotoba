"""The corpus becomes shared: channels have followers, and a line or video can be kept by several
users, each into their own sentence or source. What was kept before accounts carries over."""
from django.conf import settings
from django.db import migrations, models


def to_many(apps, schema_editor):
    Line = apps.get_model("corpus", "Line")
    Video = apps.get_model("corpus", "Video")
    Line.sentences.through.objects.bulk_create(
        [Line.sentences.through(line_id=lid, sentence_id=sid)
         for lid, sid in Line.objects.exclude(sentence=None).values_list("id", "sentence_id")])
    Video.sources.through.objects.bulk_create(
        [Video.sources.through(video_id=vid, source_id=sid)
         for vid, sid in Video.objects.exclude(source=None).values_list("id", "source_id")])


def to_one(apps, schema_editor):
    Line = apps.get_model("corpus", "Line")
    Video = apps.get_model("corpus", "Video")
    for row in Line.sentences.through.objects.order_by("id"):
        Line.objects.filter(pk=row.line_id, sentence=None).update(sentence_id=row.sentence_id)
    for row in Video.sources.through.objects.order_by("id"):
        if not Video.objects.filter(source_id=row.source_id).exists():
            Video.objects.filter(pk=row.video_id, source=None).update(source_id=row.source_id)


class Migration(migrations.Migration):

    dependencies = [
        ('corpus', '0001_initial'),
        ('library', '0021_accounts'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='channel',
            name='followers',
            field=models.ManyToManyField(blank=True, related_name='channels', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='line',
            name='sentences',
            field=models.ManyToManyField(blank=True, related_name='heard_from', to='library.sentence'),
        ),
        migrations.AddField(
            model_name='video',
            name='sources',
            field=models.ManyToManyField(blank=True, related_name='heard_videos', to='library.source'),
        ),
        migrations.RunPython(to_many, to_one),
        migrations.RemoveField(
            model_name='line',
            name='sentence',
        ),
        migrations.RemoveField(
            model_name='video',
            name='source',
        ),
    ]
