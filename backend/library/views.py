import base64
import binascii
import io
import mimetypes
import re
from datetime import datetime, timezone as dt_timezone

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Avg, Count, Max, Q
from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from PIL import Image, UnidentifiedImageError
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from . import dictionary, ingest, romanize, srs
from .models import Attempt, Deck, DeckItem, Sentence, Source, fold
# not in every system mime table; browsers need it to play rendered takes
mimetypes.add_type("audio/mp4", ".m4a")

from .serializers import (AttemptSerializer, DeckSerializer, SentenceSerializer, SourceSerializer,
                          clean_labels, MAX_LABELS)

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac"}
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov"}
SUB_EXT = {".srt", ".vtt", ".ass", ".ssa"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def _search_filter(qs, q, prefix=""):
    """Text (any script, kana-insensitive), labels, category, or a reading typed in
    Latin letters: tokyo finds 東京."""
    q = q.strip()
    if not q:
        return qs
    f = fold(q)
    cond = (Q(**{f"{prefix}search__contains": f}) | Q(**{f"{prefix}source__category__icontains": q}) |
            Q(**{f"{prefix}source__labels__icontains": q}))
    rq = romanize.key(q) if re.search("[a-z]", f) else ""
    if len(rq) >= 2:
        cond |= Q(**{f"{prefix}search__contains": rq})
    return qs.filter(cond)


def _make_sentences(source, rows):
    """rows: [text] or [(start, end, text)]"""
    source.sentences.all().delete()
    for i, row in enumerate(rows):
        start, end, text = row if isinstance(row, tuple) else (None, None, row)
        Sentence(source=source, position=i, text=text, start=start, end=end).save()


# ---------------------------------------------------------------- sources

class SourceViewSet(viewsets.ModelViewSet):
    serializer_class = SourceSerializer
    http_method_names = ["get", "patch", "delete", "post"]

    def get_queryset(self):
        qs = Source.objects.prefetch_related("sentences__attempts", "sentences__decks")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("category"):
            qs = qs.filter(category=p["category"])
        if p.get("label"):
            qs = qs.filter(labels__icontains=f'"{p["label"]}"')
        if p.get("q"):
            q = p["q"]
            ids = _search_filter(Sentence.objects.all(), q).values("source_id")
            qs = qs.filter(Q(id__in=ids) | Q(title__icontains=q) | Q(text__icontains=q))
        return qs

    def create(self, request):
        return Response({"error": "use /api/collect/*"}, status=405)

    def partial_update(self, request, *args, **kwargs):
        source = self.get_object()
        old_text = source.text
        response = super().partial_update(request, *args, **kwargs)
        source.refresh_from_db()
        # editing the raw text of a capture or paste re-splits it into sentences
        if source.text != old_text and source.kind in (Source.Kind.CAPTURE, Source.Kind.TEXT):
            _make_sentences(source, ingest.split_text(source.text))
            response.data = SourceSerializer(source).data
        return response

    @action(detail=True, methods=["post"])
    def sentences(self, request, pk=None):
        """Replace the sentences: [{text, start?, end?}]"""
        source = self.get_object()
        rows = []
        for item in request.data.get("sentences", []):
            text = str(item.get("text", "")).strip()
            if text:
                rows.append((item.get("start"), item.get("end"), text))
        with transaction.atomic():
            _make_sentences(source, rows)
        return Response(SourceSerializer(source).data)

    @action(detail=True, methods=["get"])
    def media(self, request, pk=None):
        source = self.get_object()
        if not source.media:
            return Response({"error": "no media"}, status=404)
        return ranged_file(request, source.media.path)


@api_view(["POST"])
def bulk(request):
    """{ids, status?, category?, labels?, add_label?, delete?}"""
    ids = [int(i) for i in request.data.get("ids", [])]
    qs = Source.objects.filter(id__in=ids)
    if request.data.get("delete"):
        n = qs.count()
        for s in qs:
            s.image.delete(save=False)
            s.media.delete(save=False)
        qs.delete()
        return Response({"deleted": n})
    add = clean_labels(request.data.get("add_label"))
    if add:
        # one label or several, comma separated; never drop labels silently past the limit
        merged = {s.id: clean_labels([*s.labels, *add]) for s in qs}
        full = [s for s in qs if len(set(map(str.lower, [*s.labels, *add]))) > MAX_LABELS]
        if full:
            return Response({"error": f"{len(full)} selected source{'s' if len(full) > 1 else ''} would have more "
                             f"than {MAX_LABELS} labels. Remove a label from {'them' if len(full) > 1 else 'it'} first."},
                            status=400)
    fields = {}
    if request.data.get("status") in Source.Status.values:
        fields["status"] = request.data["status"]
    if isinstance(request.data.get("category"), str):
        fields["category"] = request.data["category"].strip()[:40]
    if fields:
        qs.update(**fields)
    if "labels" in request.data:
        qs.update(labels=clean_labels(request.data["labels"]))
    if add:
        for s in qs:
            s.labels = merged[s.id]
            s.save(update_fields=["labels"])
    return Response({"updated": qs.count()})


def ranged_file(request, path):
    """Serve a file with HTTP Range support, so <audio> can seek to a sentence."""
    import os
    size = os.path.getsize(path)
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    m = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("Range", ""))
    if not m or not (m[1] or m[2]):
        resp = FileResponse(open(path, "rb"), content_type=ctype)
        resp["Accept-Ranges"] = "bytes"
        return resp
    if m[1]:
        start, end = int(m[1]), min(int(m[2]) if m[2] else size - 1, size - 1)
    else:
        start, end = max(0, size - int(m[2])), size - 1
    if start > end:
        resp = HttpResponse(status=416)
        resp["Content-Range"] = f"bytes */{size}"
        return resp

    def chunks():
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    resp = StreamingHttpResponse(chunks(), status=206, content_type=ctype)
    resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    resp["Content-Length"] = str(end - start + 1)
    resp["Accept-Ranges"] = "bytes"
    return resp


# ---------------------------------------------------------------- collect

@api_view(["POST"])
def captures(request):
    """screen-ocr's push contract, unchanged: {text, category, created_at, image: base64 PNG|null}.
    Sending the same capture twice (a retry whose answer got lost) returns the first."""
    body = request.data
    text, category, created_at = body.get("text"), body.get("category", ""), body.get("created_at")
    if (not isinstance(text, str) or not text.strip() or not isinstance(category, str)
            or not isinstance(created_at, (int, float)) or isinstance(created_at, bool)):
        return Response({"error": 'expected {"text": str, "category": str, "created_at": number, '
                                  '"image": base64 PNG or null}'}, status=400)
    when = datetime.fromtimestamp(float(created_at), tz=dt_timezone.utc)
    existing = Source.objects.filter(kind=Source.Kind.CAPTURE, created_at=when, text=text).first()
    if existing:
        return Response({"id": existing.id})
    png = None
    if body.get("image"):
        try:
            png = base64.b64decode(body["image"], validate=True)
            Image.open(io.BytesIO(png)).verify()
        except (binascii.Error, TypeError, UnidentifiedImageError, OSError):
            return Response({"error": "image is not a base64 PNG"}, status=400)
    with transaction.atomic():
        source = Source.objects.create(kind=Source.Kind.CAPTURE, text=text.strip(),
                                       category=category.strip()[:40], created_at=when)
        if png:
            source.image.save(f"{source.id}.png", ContentFile(png))
        _make_sentences(source, ingest.split_text(source.text))
    return Response({"id": source.id}, status=201)


@api_view(["POST"])
def collect_text(request):
    text = str(request.data.get("text", "")).strip()
    if not text:
        return Response({"error": "Paste some Japanese text first."}, status=400)
    with transaction.atomic():
        source = Source.objects.create(kind=Source.Kind.TEXT, text=text,
                                       title=str(request.data.get("title", "")).strip()[:200],
                                       labels=clean_labels(request.data.get("labels")))
        _make_sentences(source, ingest.split_text(text))
    return Response(SourceSerializer(source).data, status=201)


@api_view(["POST"])
def collect_file(request):
    """Upload audio, video, a subtitle file or an image. A subtitle file uploaded with
    its audio/video (field `media`) becomes one source with timed sentences."""
    import os
    f = request.FILES.get("file")
    if not f:
        return Response({"error": "No file in the upload."}, status=400)
    ext = os.path.splitext(f.name)[1].lower()
    media = request.FILES.get("media")
    title = os.path.splitext(f.name)[0]
    labels = clean_labels(request.data.getlist("labels"))
    with transaction.atomic():
        if ext in SUB_EXT:
            raw = f.read().decode("utf-8-sig", errors="replace")
            cues = ingest.parse_subtitles(raw)
            if not cues:
                return Response({"error": "No subtitle lines found in that file."}, status=400)
            kind = Source.Kind.SUBTITLE
            if media:
                mext = os.path.splitext(media.name)[1].lower()
                kind = Source.Kind.VIDEO if mext in VIDEO_EXT else Source.Kind.AUDIO
            source = Source.objects.create(kind=kind, title=title, labels=labels,
                                           text="\n".join(c[2] for c in cues))
            if media:
                source.media.save(media.name, media)
            _make_sentences(source, cues)
        elif ext in AUDIO_EXT | VIDEO_EXT:
            kind = Source.Kind.VIDEO if ext in VIDEO_EXT else Source.Kind.AUDIO
            source = Source.objects.create(kind=kind, title=title, labels=labels, job=Source.Job.WAITING)
            source.media.save(f.name, f)
            from speech import jobs
            transaction.on_commit(jobs.kick)
        elif ext in IMAGE_EXT:
            source = Source.objects.create(kind=Source.Kind.CAPTURE, title=title, labels=labels)
            source.image.save(f.name, f)
        else:
            return Response({"error": f"kotoba can't use {ext or 'that'} files yet. Audio, video, "
                                      "subtitles (.srt .vtt .ass) and images work."}, status=400)
    return Response(SourceSerializer(source).data, status=201)


# ---------------------------------------------------------------- sentences

class SentenceViewSet(viewsets.ModelViewSet):
    serializer_class = SentenceSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_queryset(self):
        qs = Sentence.objects.select_related("source").prefetch_related("attempts", "decks")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(source__status=p["status"])
        if p.get("source"):
            qs = qs.filter(source_id=p["source"])
        if p.get("deck"):
            qs = qs.filter(decks__id=p["deck"]).order_by("deckitem__position")
        if p.get("category"):
            qs = qs.filter(source__category=p["category"])
        if p.get("label"):
            qs = qs.filter(source__labels__icontains=f'"{p["label"]}"')
        if p.get("q"):
            qs = _search_filter(qs, p["q"])
        if not p.get("deck"):
            qs = qs.order_by("-source__created_at", "position")
        return qs

    @action(detail=True, methods=["get"])
    def attempts(self, request, pk=None):
        return Response(AttemptSerializer(self.get_object().attempts.all()[:50], many=True).data)


@api_view(["GET"])
def facets(request):
    """Categories and labels in use, with counts, for the library filters."""
    cats = (Source.objects.exclude(status=Source.Status.ARCHIVED).exclude(category="")
            .values("category").annotate(n=Count("id")).order_by("-n"))
    labels = {}
    for ls in Source.objects.exclude(status=Source.Status.ARCHIVED).values_list("labels", flat=True):
        for label in ls:
            labels[label] = labels.get(label, 0) + 1
    return Response({
        "categories": [{"name": c["category"], "count": c["n"]} for c in cats],
        "labels": [{"name": k, "count": v} for k, v in sorted(labels.items(), key=lambda kv: -kv[1])],
    })


@api_view(["GET"])
def stats(request):
    from speech import jobs
    jobs.kick()   # the app polls this: a cheap moment to pick up waiting uploads
    now = timezone.now()
    return Response({
        "inbox": Source.objects.filter(status=Source.Status.INBOX).count(),
        "due": Sentence.objects.filter(due__lte=now).exclude(source__status=Source.Status.ARCHIVED).count(),
        "sentences": Sentence.objects.exclude(source__status=Source.Status.ARCHIVED).count(),
        "decks": Deck.objects.count(),
        "attempts_today": Attempt.objects.filter(created_at__date=timezone.localdate()).count(),
        "waiting": Source.objects.filter(job__in=[Source.Job.WAITING, Source.Job.RUNNING]).count(),
    })


@api_view(["GET"])
def lookup(request):
    """?text=<sentence>&at=<character offset>: the word there, its readings and meanings.
    The first lookup starts the one-time dictionary download."""
    text = request.query_params.get("text", "")[:2000]
    try:
        at = int(request.query_params.get("at", ""))
    except ValueError:
        return Response({"error": "at must be a character offset"}, status=400)
    dictionary.ensure()
    return Response({"word": dictionary.lookup(text, at), "dictionary": dictionary.status()})


# ---------------------------------------------------------------- decks

class DeckViewSet(viewsets.ModelViewSet):
    serializer_class = DeckSerializer

    def get_queryset(self):
        now = timezone.now()
        return Deck.objects.annotate(
            size=Count("items", distinct=True),
            due=Count("items", filter=Q(items__sentence__due__lte=now), distinct=True),
            practised=Count("items", filter=Q(items__sentence__reps__gt=0) | Q(items__sentence__last__isnull=False),
                            distinct=True),
            average=Avg("items__sentence__last"),
        )

    @action(detail=True, methods=["post"])
    def add(self, request, pk=None):
        """{sentences: [ids]} appended in order; already-present ones are skipped."""
        deck = self.get_object()
        pos = (deck.items.aggregate(m=Max("position"))["m"] or 0) + 1
        have = set(deck.items.values_list("sentence_id", flat=True))
        for sid in request.data.get("sentences", []):
            if int(sid) not in have and Sentence.objects.filter(id=sid).exists():
                DeckItem.objects.create(deck=deck, sentence_id=sid, position=pos)
                pos += 1
        return Response(self.get_serializer(self.get_queryset().get(pk=deck.pk)).data)

    @action(detail=True, methods=["post"])
    def remove(self, request, pk=None):
        self.get_object().items.filter(sentence_id__in=request.data.get("sentences", [])).delete()
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def order(self, request, pk=None):
        """{sentences: [ids in the new order]}"""
        deck = self.get_object()
        for i, sid in enumerate(request.data.get("sentences", [])):
            deck.items.filter(sentence_id=sid).update(position=i)
        return Response(status=204)


# ---------------------------------------------------------------- practice

@api_view(["POST"])
def attempts(request):
    ser = AttemptSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    with transaction.atomic():
        attempt = ser.save()
        sentence = attempt.sentence
        srs.schedule(sentence, attempt.overall)
        sentence.save(update_fields=["due", "interval", "ease", "reps", "lapses", "best", "last"])
    return Response({"attempt": ser.data, "sentence": SentenceSerializer(sentence).data}, status=201)


@api_view(["GET"])
def review(request):
    """Sentences due now, most overdue first, plus a few never-practised ones from kept
    sources so a fresh library has something to review."""
    now = timezone.now()
    limit = min(int(request.query_params.get("limit", 20)), 100)
    base = Sentence.objects.exclude(source__status=Source.Status.ARCHIVED).select_related("source")
    due = list(base.filter(due__lte=now).order_by("due")[:limit])
    fresh = []
    if len(due) < limit and request.query_params.get("new", "1") == "1":
        fresh = list(base.filter(due__isnull=True, source__status=Source.Status.KEPT)
                     .order_by("source__created_at", "position")[:min(5, limit - len(due))])
    upcoming = base.filter(due__gt=now).order_by("due").values_list("due", flat=True).first()
    return Response({"due": SentenceSerializer(due, many=True).data,
                     "new": SentenceSerializer(fresh, many=True).data,
                     "next_due": upcoming})
