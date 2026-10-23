import base64
import binascii
import io
import json
import mimetypes
import re
import wave
from collections import defaultdict
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

from . import dictionary, ingest, romanize, srs, translate, words
from .models import Attempt, Deck, DeckItem, Lesson, Sentence, Source, Word, WordUse, fold
# not in every system mime table; browsers need it to play rendered takes
mimetypes.add_type("audio/mp4", ".m4a")

from .serializers import (AttemptSerializer, DeckSerializer, SentenceSerializer, SourceSerializer,
                          clean_labels, MAX_LABELS)

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac"}
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov"}
SUB_EXT = {".srt", ".vtt", ".ass", ".ssa"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def _search_filter(qs, q, prefix=""):
    """Text (any script, kana-insensitive), labels, category, a reading typed in Latin
    letters (tokyo finds 東京), or a word of its translation (library)."""
    q = q.strip()
    if not q:
        return qs
    f = fold(q)
    cond = (Q(**{f"{prefix}search__contains": f}) | Q(**{f"{prefix}source__category__icontains": q}) |
            Q(**{f"{prefix}source__labels__icontains": q}))
    rq = romanize.key(q) if re.search("[a-z]", f) else ""
    if len(rq) >= 2:
        cond |= Q(**{f"{prefix}search__contains": rq})
    if rq and len(q) >= 3:
        cond |= Q(**{f"{prefix}translations__icontains": q})
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
        qs = Source.objects.prefetch_related("sentences__attempts", "sentences__decks", "lessons")
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
    http_method_names = ["get", "post", "patch", "delete"]  # post is only for actions

    def create(self, request, *args, **kwargs):
        return Response({"error": "Sentences come from sources."}, status=405)

    def get_queryset(self):
        qs = Sentence.objects.select_related("source").prefetch_related("attempts", "decks")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(source__status=p["status"])
        if p.get("kind"):  # one or more, comma-separated: kind=audio,video
            qs = qs.filter(source__kind__in=p["kind"].split(","))
        if p.get("practice") == "new":
            qs = qs.filter(last__isnull=True)
        elif p.get("practice") == "practised":
            qs = qs.filter(last__isnull=False)
        elif p.get("practice") == "due":
            qs = qs.filter(due__lte=timezone.now())
        if p.get("source"):
            qs = qs.filter(source_id=p["source"])
        if p.get("deck"):
            qs = qs.filter(decks__id=p["deck"]).order_by("deckitem__position")
        if p.get("category"):
            qs = qs.filter(source__category=p["category"])
        if p.get("label"):
            qs = qs.filter(source__labels__icontains=f'"{p["label"]}"')
        if p.get("q"):
            qs = _sentence_search(qs, p["q"].strip())
        if not p.get("deck"):
            qs = qs.order_by("-source__created_at", "position")
        return qs

    @action(detail=True, methods=["get"])
    def attempts(self, request, pk=None):
        return Response(AttemptSerializer(self.get_object().attempts.all()[:50], many=True).data)

    @action(detail=True, methods=["post"])
    def translate(self, request, pk=None):
        """Translate into the chosen language; {"force": true} replaces an existing one."""
        sentence = self.get_object()
        try:
            translate.translate(sentence, request.data.get("to"), force=bool(request.data.get("force")))
        except translate.TranslateError as e:
            return Response({"error": str(e)}, status=503)
        return Response(self.get_serializer(sentence).data)


@api_view(["GET", "PATCH"])
def translation(request):
    """The translator's status, the saved translators and the language sentences are
    translated into. PATCH {"to": "fr"} picks the language, {"active": id} the translator."""
    if request.method == "PATCH":
        try:
            if "to" in request.data:
                translate.set_language(request.data.get("to", ""))
            if "active" in request.data:
                translate.activate(str(request.data["active"]))
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        except KeyError:
            return Response({"error": "That translator no longer exists."}, status=404)
    lang = translate.language()
    if request.query_params.get("quick"):  # just the language, without asking the LLM server
        active = translate.public(next(t for t in translate.translators() if t["id"] == translate.active_id()))
        return Response({"to": lang, "name": translate.LANGUAGES[lang],
                         "translator": active["name"], "cloud": active["cloud"]})
    sentences = Sentence.objects.exclude(source__status=Source.Status.ARCHIVED)
    return Response({
        **translate.status(), "to": lang, "name": translate.LANGUAGES[lang],
        "languages": [{"code": k, "name": v} for k, v in translate.LANGUAGES.items()],
        "translated": sentences.filter(**{f"translations__{lang}__isnull": False}).count(),
        "sentences": sentences.count(),
        "active": translate.active_id(),
        "translators": [translate.public(t) for t in translate.translators()],
        "defaults": translate.defaults(),
    })


@api_view(["POST"])
def translators(request):
    """Save a translator; {"activate": true} also makes it the one in use."""
    try:
        t = translate.add_translator(request.data, activate=bool(request.data.get("activate")))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    return Response(translate.public(t), status=201)


@api_view(["PATCH", "DELETE"])
def translator(request, tid):
    try:
        if request.method == "DELETE":
            translate.remove_translator(tid)
            return Response(status=204)
        t = translate.update_translator(tid, request.data, activate=bool(request.data.get("activate")))
    except KeyError:
        return Response({"error": "That translator no longer exists."}, status=404)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    return Response(translate.public(t))


@api_view(["POST"])
def translator_test(request):
    """Try a translator from the form without saving it: does it answer, and with which models."""
    try:
        cfg = translate.draft(request.data)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    return Response(translate.status(cfg))


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
    from corpus import worker
    from speech import jobs
    jobs.kick()   # the app polls this: a cheap moment to pick up waiting uploads
    words.kick()  # and sentences the word index hasn't read
    worker.kick() # and channels due a look (kotoba isn't always on, so no schedule)
    now = timezone.now()
    return Response({
        "inbox": Source.objects.filter(status=Source.Status.INBOX).count(),
        "due": Sentence.objects.filter(due__lte=now).exclude(source__status=Source.Status.ARCHIVED).count(),
        "sentences": Sentence.objects.exclude(source__status=Source.Status.ARCHIVED).count(),
        "decks": Deck.objects.count(),
        "lessons": Lesson.objects.filter(done_at__isnull=True).count(),
        "attempts_today": Attempt.objects.filter(created_at__date=timezone.localdate()).count(),
        "waiting": Source.objects.filter(job__in=[Source.Job.WAITING, Source.Job.RUNNING]).count(),
    })


@api_view(["GET"])
def furigana(request):
    """?text=<sentence>: the readings kotoba would give it, as [kanji, reading] pairs, so a
    sentence being edited can show and correct them before it's saved."""
    return Response({"furigana": romanize.furigana(request.query_params.get("text", "")[:2000].strip())})


@api_view(["GET"])
def lookup(request):
    """?text=<sentence>&at=<character offset>[&pairs=<JSON [kanji, reading] pairs>]: the word
    there, its readings and meanings; `pairs` are the furigana the sentence shows, which the
    word's readings then follow. The first lookup starts the one-time dictionary download."""
    text = request.query_params.get("text", "")[:2000]
    try:
        at = int(request.query_params.get("at", ""))
    except ValueError:
        return Response({"error": "at must be a character offset"}, status=400)
    try:
        pairs = json.loads(request.query_params.get("pairs") or "[]")
    except ValueError:
        pairs = []
    if not (isinstance(pairs, list) and all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p) for p in pairs)):
        pairs = []
    dictionary.ensure()
    end = request.query_params.get("end")
    if end:  # a selected stretch, text[at:end]
        try:
            word = dictionary.span(text, at, int(end), pairs)
        except ValueError:
            return Response({"error": "end must be a character offset"}, status=400)
    else:
        word = dictionary.lookup(text, at, pairs)
    return Response({"word": word, "key": _key(word), "library": _in_library(word), "dictionary": dictionary.status()})


@api_view(["POST"])
def dictionary_fetch(request):
    """Start the one-time dictionary download now, rather than with the first lookup."""
    dictionary.ensure()
    return Response(dictionary.status())


def _key(word):
    """The looked-up word's key, as the word index files it (j:<JMdict id>, or m:<form>/<reading>)."""
    if not word:
        return None
    form, reading = (word["lemma"], word["lemma_reading"]) if word["lemma"] else (word["surface"], word["reading"])
    head = dictionary.headword(form, reading) if word["entries"] else None
    return f"j:{head['id']}" if head else f"m:{form}/{romanize._hira(reading or '')}"


def _in_library(word):
    """The looked-up word in the word index, when your sentences have it: {id, sentences, status}."""
    if not word:
        return None
    found = words.with_counts(Word.objects.filter(key=_key(word))).first()
    return {"id": found.id, "sentences": found.sentences, "status": words.status(found)} if found else None


@api_view(["POST"])
def explain(request):
    """{text, context}: what a selected stretch of Japanese means where it stands, from the
    translator in use: a translation and a few notes on its grammar, words and nuance."""
    text = " ".join(str(request.data.get("text", "")).split())
    context = str(request.data.get("context", "")).strip()[:2000]
    if not text:
        return Response({"error": "Select some Japanese to explain."}, status=400)
    if len(text) > 500:
        return Response({"error": "That's a lot at once: select at most 500 characters."}, status=400)
    try:
        out = translate.explain(text, context, request.data.get("to"), force=bool(request.data.get("force")))
    except translate.TranslateError as e:
        return Response({"error": str(e)}, status=503)
    active = translate.public(next(t for t in translate.translators() if t["id"] == translate.active_id()))
    return Response({"translator": active["name"], "cloud": active["cloud"], **out})  # who answered, if saved


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


TAKE_RATE = 16000
TAKE_MAX = TAKE_RATE * 2 * 90  # the recorder stops itself at 60 s


@api_view(["PUT", "DELETE"])
def attempt_audio(request, pk):
    """Keep a take to hear again later: the body is the take as it was scored, 16 kHz mono
    int16 PCM, stored as a WAV. DELETE lets it go; the score stays."""
    attempt = get_object_or_404(Attempt, pk=pk)
    if attempt.audio:
        attempt.audio.delete(save=False)
    if request.method == "DELETE":
        attempt.save(update_fields=["audio"])
        return Response(status=204)
    pcm = request.body
    if not pcm or len(pcm) % 2 or len(pcm) > TAKE_MAX:
        return Response({"error": "Send the take as 16 kHz mono 16-bit PCM, at most 90 seconds."}, status=400)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(TAKE_RATE)
        w.writeframes(pcm)
    attempt.audio.save(f"{attempt.sentence_id}-{attempt.id}.wav", ContentFile(buf.getvalue()))
    return Response(AttemptSerializer(attempt).data)


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


# ---------------------------------------------------------------- words

def _word_row(w, checked=None) -> dict:
    tries = checked.get(w.id, []) if checked is not None else []
    return {"id": w.id, "key": w.key, "lemma": w.lemma, "reading": w.reading, "romaji": dictionary._romaji(w.reading) if w.reading else "",
            "entry": w.entry, "status": words.status(w), "known_at": w.known_at,
            "sentences": getattr(w, "sentences", None), "sources": getattr(w, "sources", None),
            "tries": len(tries), "misses": tries.count(False), "trouble": words.troubled(tries) if tries else False}


def _index_state() -> dict:
    words.kick()
    return {"pending": words.pending(), "dictionary": dictionary.status()["state"]}


WORD_SORTS = {"count": ("-sentences", "lemma"), "recent": ("-created_at", "lemma"), "az": ("reading", "lemma")}


@api_view(["GET"])
def word_list(request):
    """?q=&status=new|practised|known|trouble&sort=count|recent|az|trouble&limit=&offset=:
    the words in the sentences you keep, with how often they come up and how saying them went."""
    p = request.query_params
    qs = words.with_counts(Word.objects.all()).filter(sentences__gt=0)
    q = p.get("q", "").strip()
    if q:
        qs = qs.filter(id__in=_word_matches(q))
    state = p.get("status", "")
    if state == "known":
        qs = qs.filter(known_at__isnull=False)
    elif state == "practised":
        qs = qs.filter(known_at__isnull=True, passed=True)
    elif state == "new":
        qs = qs.filter(known_at__isnull=True, passed=False)
    sort = p.get("sort", "count")
    try:
        limit, offset = min(int(p.get("limit", 100)), 500), max(int(p.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit and offset are numbers"}, status=400)
    if state == "trouble" or sort == "trouble":
        checked = words.checks()
        if state == "trouble":
            qs = qs.filter(id__in=[wid for wid, tries in checked.items() if words.troubled(tries)])
        rows = list(qs)
        rows.sort(key=lambda w: (-checked.get(w.id, []).count(False), -w.sentences, w.lemma))
        page = rows[offset:offset + limit]
        return Response({"count": len(rows), "results": [_word_row(w, checked) for w in page], **_index_state()})
    count = qs.count()
    page = list(qs.order_by(*WORD_SORTS.get(sort, WORD_SORTS["count"]))[offset:offset + limit])
    checked = words.checks([w.id for w in page])
    return Response({"count": count, "results": [_word_row(w, checked) for w in page], **_index_state()})


def _sentence_search(qs, q, word_ids=None):
    """Sentences by their text, reading or translation, and those using a word the search finds,
    in any form: できる finds できます, library finds 図書館. A search finding many words (a
    common kanji) only goes by the text."""
    ids = list(_word_matches(q) if word_ids is None else word_ids)
    text = _search_filter(Sentence.objects.all(), q).values("id")
    if not ids or len(ids) > 20:
        return qs.filter(id__in=text)
    return qs.filter(Q(id__in=text) | Q(id__in=WordUse.objects.filter(word__in=ids).values("sentence_id")))


def _word_matches(q: str) -> set:
    """Ids of the words a search finds: by spelling, any form seen (読んで), reading or romaji
    (toshokan), a kanji in it, or, typed in Latin letters, a meaning (library finds 図書館)."""
    f = fold(q)
    cond = Q(search__contains=f) | Q(uses__surface__contains=q)
    latin = re.search("[a-z]", f)
    rq = romanize.key(q) if latin else ""
    if len(rq) >= 2:
        cond |= Q(search__contains=rq)
    found = set(Word.objects.filter(cond).values_list("id", flat=True))
    if latin and len(q.strip()) >= 3:
        entries = dict(Word.objects.exclude(entry=None).values_list("entry", "id"))
        found |= {entries[e] for e in dictionary.meaning_matches(entries, q)}
    return found


def _meaning(word) -> str:
    """The first sense, short: "library; reading room"."""
    found = dictionary.entry(word.entry) if word.entry else []
    return "; ".join(found[0]["senses"][0]["gloss"][:3]) if found and found[0]["senses"] else ""


@api_view(["GET"])
def search(request):
    """?q=: everything at once, a few of each: words (by spelling, reading or meaning), sentences
    (by text, reading or translation), sources, lessons and decks, each with how many there are."""
    q = request.query_params.get("q", "").strip()[:200]
    if not q:
        return Response({"q": q, "words": [], "sentences": [], "sources": [], "lessons": [], "decks": [], "counts": {}})
    found = _word_matches(q)
    ws = words.with_counts(Word.objects.filter(id__in=found)).filter(sentences__gt=0)
    exact = fold(q)
    top_words = sorted(ws, key=lambda w: (fold(w.lemma) != exact and w.reading != exact, -w.sentences, w.lemma))
    live = Sentence.objects.exclude(source__status=Source.Status.ARCHIVED).select_related("source").prefetch_related("attempts", "decks")
    sentences = _sentence_search(live, q, [w.id for w in top_words]).order_by("-source__created_at", "position")
    ids = _search_filter(Sentence.objects.all(), q).values("source_id")
    sources = (Source.objects.filter(Q(id__in=ids) | Q(title__icontains=q) | Q(text__icontains=q))
               .annotate(n=Count("sentences")).order_by("-created_at"))
    lessons = (Lesson.objects.filter(Q(title__icontains=q) | Q(notes__icontains=q) | Q(folder__name__icontains=q)
                                     | Q(files__name__icontains=q)).distinct().order_by("done_at", "-created_at"))
    decks = Deck.objects.filter(Q(name__icontains=q) | Q(description__icontains=q) | Q(folder__icontains=q)).annotate(n=Count("items"))
    return Response({
        "q": q,
        "words": [{**_word_row(w), "meaning": _meaning(w)} for w in top_words[:8]],
        "sentences": SentenceSerializer(sentences[:10], many=True).data,
        "sources": [{"id": s.id, "kind": s.kind, "status": s.status, "title": str(s) or "Untitled", "sentences": s.n,
                     "created_at": s.created_at} for s in sources[:6]],
        "lessons": [{"id": l.id, "title": l.title, "done": l.done_at is not None} for l in lessons[:6]],
        "decks": [{"id": d.id, "name": d.name, "size": d.n} for d in decks[:6]],
        "counts": {"words": len(top_words), "sentences": sentences.count(), "sources": sources.count(),
                   "lessons": lessons.count(), "decks": decks.count()},
    })


@api_view(["GET", "PATCH"])
def word_detail(request, pk):
    """A word with its meanings, the sentences it's in (the spans it covers in each) and how saying
    it went. PATCH {"known": true|false} marks it known, or not."""
    word = get_object_or_404(Word, pk=pk)
    if request.method == "PATCH":
        if "known" in request.data:
            word.known_at = timezone.now() if request.data.get("known") else None
            word.save(update_fields=["known_at"])
    word = words.with_counts(Word.objects.filter(pk=pk)).get()
    uses = list(words.live_uses().filter(word=word).select_related("sentence")
                .order_by("-sentence__source__created_at", "sentence__position", "start"))
    spans, order = {}, []
    for u in uses:
        if u.sentence_id not in spans:
            spans[u.sentence_id] = []
            order.append(u.sentence_id)
        if u.sentence.text[u.start:u.end] == u.surface:  # not yet read again after an edit
            spans[u.sentence_id].append([u.start, u.end])
    shown = order[:200]
    found = Sentence.objects.select_related("source").prefetch_related("attempts", "decks").in_bulk(shown)
    sentences = [{**SentenceSerializer(found[sid]).data, "spans": spans[sid]} for sid in shown if sid in found]
    checked = words.checks([word.id])
    forms = sorted({u.surface for u in uses}, key=lambda f: (f != word.lemma, len(f), f))[:12]
    kanji = [{"char": c, "words": Word.objects.filter(lemma__contains=c, uses__isnull=False).distinct().count()}
             for c in dict.fromkeys(romanize.HAN.findall(word.lemma))]
    return Response({**_word_row(word, checked), "forms": forms, "kanji": kanji,
                     "entries": dictionary.entry(word.entry) if word.entry else
                     dictionary.entries([word.lemma], word.reading) if dictionary.path().exists() else [],
                     "results": checked.get(word.id, []),
                     "sentence_list": sentences, "more": max(0, len(order) - len(shown)), **_index_state()})


@api_view(["GET"])
def word_next(request):
    """Sentences you're one new word away from, the most useful word first."""
    try:
        limit = min(int(request.query_params.get("limit", 20)), 100)
    except ValueError:
        return Response({"error": "limit is a number"}, status=400)
    picks = words.next_sentences(limit)
    spans = defaultdict(list)
    for u in WordUse.objects.filter(sentence__in=[s for s, _, _ in picks], word__in=[w for _, w, _ in picks]):
        spans[(u.sentence_id, u.word_id)].append([u.start, u.end])
    return Response({"results": [{"sentence": SentenceSerializer(s).data, "word": _word_row(w), "sentences": n,
                                  "spans": spans[(s.id, w.id)]} for s, w, n in picks], **_index_state()})


@api_view(["GET"])
def sentence_words(request, pk):
    """The words of a sentence (with how often each comes up) and other sentences sharing its rarer ones."""
    sentence = get_object_or_404(Sentence, pk=pk)
    uses = list(sentence.word_uses.all())
    by_id = {w.id: w for w in words.with_counts(Word.objects.filter(id__in={u.word_id for u in uses}))}
    checked = words.checks(list(by_id))
    out = [{**_word_row(by_id[u.word_id], checked), "start": u.start, "end": u.end, "surface": u.surface}
           for u in uses if u.word_id in by_id and sentence.text[u.start:u.end] == u.surface]
    related = [{"sentence": SentenceSerializer(s).data, "shared": [{"id": w.id, "lemma": w.lemma, "reading": w.reading} for w in ws]}
               for s, ws in words.related(sentence)]
    return Response({"words": out, "related": related, "indexed": sentence.words_engine == words.engine(), **_index_state()})


@api_view(["GET"])
def source_words(request, pk):
    """How much of a source's vocabulary you have, and its new words that come up most."""
    source = get_object_or_404(Source, pk=pk)
    cov = words.coverage(source)
    cov["top_new"] = [_word_row(w) for w in cov["top_new"]]
    waiting = source.sentences.exclude(words_engine=words.engine()).count()
    return Response({**cov, "waiting": waiting, **_index_state()})
