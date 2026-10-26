import mimetypes
import re

from django.db import transaction
from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from library import dictionary, romanize, words
from library.models import Word, fold
from library.views import ranged_file

from . import heard, worker, ytdlp
from .models import Channel, Line, Term, TermUse, Video

mimetypes.add_type("audio/webm", ".weba")  # a video's audio track, as YouTube serves it


def _off():
    return Response({"error": "YouTube listening is off. Turn it on in Add-ons."}, status=409)


def _channel_json(ch: Channel, s: dict) -> dict:
    by = s["by"].get(ch.id, {})
    return {"id": ch.id, "kind": ch.kind, "title": ch.title, "url": ch.url, "checked_at": ch.checked_at, "error": ch.error,
            "videos": {k: by.get(k, 0) for k in Video.Subs.values}, "lines": s["lines"].get(ch.id, 0)}


@api_view(["GET", "PATCH"])
def status(request):
    """The add-on: on or off, its yt-dlp, what the background reader is doing and the channels
    followed. PATCH {"enabled": bool} turns it on (fetching yt-dlp the first time) or off."""
    user = request.user
    if request.method == "PATCH" and "enabled" in request.data:
        on = bool(request.data["enabled"])
        heard.set_enabled(user, on)
        if on and ytdlp.missing():
            worker.install_tools()
    worker.kick()
    s = heard.summary()
    followed = Channel.objects.filter(followers=user)
    channels = followed.exclude(kind=Channel.Kind.SEARCH)
    searched = (Video.objects.filter(channels__in=followed.filter(kind=Channel.Kind.SEARCH))
                .exclude(channels__in=channels))
    tools = worker.tools_state()
    js = ytdlp.js_runtime()
    return Response({
        "enabled": heard.enabled(user),
        "tool": {"installed": ytdlp.available(), "version": ytdlp.version(), "installing": tools["state"] == "installing",
                 "error": tools["error"], "js": js[0] if js else None, "note": ytdlp.environ_note(), "pot": ytdlp.pot(), "updated": worker.state["updated"]},
        "worker": {"busy": worker.busy(), "doing": worker.state["doing"], "channel": worker.state["channel"], "error": worker.state["error"],
                   "paused_until": worker.paused() or None},
        "channels": [_channel_json(c, s) for c in channels],
        "found": {"videos": searched.filter(subs=Video.Subs.OK).distinct().count(),
                  "lines": Line.objects.filter(video__in=searched.filter(subs=Video.Subs.OK)).count()},
        "lines": Line.objects.filter(video__in=heard.videos(user)).count(),
    })


@api_view(["POST"])
def update(request):
    """Bring yt-dlp up to date now."""
    try:
        said = ytdlp.update()
    except Exception as e:  # noqa: BLE001
        return Response({"error": f"Couldn't update yt-dlp: {e}"}, status=503)
    worker.state["updated"] = said
    return Response({"updated": said, "version": ytdlp.version()})


@api_view(["POST"])
def channels(request):
    """{url}: follow a channel (its uploads) or a playlist. One someone else follows is read
    already: its lines are there at once."""
    if not heard.enabled(request.user):
        return _off()
    try:
        kind, url = ytdlp.normalize(str(request.data.get("url", "")))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    ch, _ = Channel.objects.get_or_create(url=url, defaults={"kind": kind})
    if ch.followers.filter(pk=request.user.pk).exists():
        return Response({"error": f"You already follow {ch}."}, status=400)
    ch.followers.add(request.user)
    worker.kick()
    return Response(_channel_json(ch, heard.summary()), status=201)


@api_view(["POST", "DELETE"])
def channel(request, pk):
    """POST reads its video list again now; DELETE stops following it, and its lines go
    (except the ones you kept, which are your sentences now). They stay in the corpus while
    someone else follows it."""
    ch = get_object_or_404(Channel.objects.filter(followers=request.user), pk=pk)
    if request.method == "POST":
        Channel.objects.filter(pk=pk).update(checked_at=None)
        worker.kick()
        return Response({"ok": True})
    with transaction.atomic():
        ch.followers.remove(request.user)
        if ch.followers.exists():
            return Response(status=204)
        ids = list(ch.videos.values_list("id", flat=True))
        ch.delete()
        Video.objects.filter(id__in=ids, channels=None, sources=None).delete()
    heard.tidy()
    return Response(status=204)


def _term(key: str):
    return Term.objects.filter(key=key).first()


def _finding(key: str, user) -> dict | None:
    """Where a "Find more" for this word is: searching, checking N videos, or done."""
    ch = Channel.objects.filter(kind=Channel.Kind.SEARCH, term_key=key, followers=user).first()
    if not ch:
        return None
    if ch.checked_at is None:
        return {"state": "searching", "error": ""}
    waiting = ch.videos.filter(subs=Video.Subs.WAITING).count()
    if waiting:
        return {"state": "checking", "waiting": waiting, "error": ""}
    ok = ch.videos.filter(subs=Video.Subs.OK)
    return {"state": "done", "at": ch.checked_at, "videos": ch.videos.count(), "subtitled": ok.count(),
            "error": ch.error}


def _reading() -> dict:
    """How much the background reader still has to do."""
    return {"busy": worker.busy(), "waiting": Video.objects.filter(subs=Video.Subs.WAITING).count(),
            "unread": Line.objects.exclude(words_engine=words.engine()).count()}


@api_view(["GET"])
def heard_lines(request):
    """?key=<word key>&offset=&limit=: the lines it's heard in, the easiest to follow first."""
    p = request.query_params
    key = p.get("key", "")
    try:
        offset, limit = max(int(p.get("offset", 0)), 0), min(int(p.get("limit", 5)), 50)
    except ValueError:
        return Response({"error": "offset and limit are numbers"}, status=400)
    worker.kick()
    user = request.user
    base = {"enabled": heard.enabled(user),
            "channels": Channel.objects.filter(followers=user).exclude(kind=Channel.Kind.SEARCH).count(),
            "finding": _finding(key, user), "reading": _reading(), "lines": [], "total": 0, "videos": 0}
    term = _term(key)
    if not base["enabled"] or not term:
        return Response(base)
    return Response({**base, **heard.lines_for(term, user, offset, limit)})


@api_view(["GET"])
def counts(request):
    """?keys=a,b: how many lines each word can be heard in."""
    keys = [k for k in request.query_params.get("keys", "").split(",") if k][:50]
    if not heard.enabled(request.user) or not keys:
        return Response({"enabled": heard.enabled(request.user), "counts": {}})
    return Response({"enabled": True, "counts": heard.counts(keys, request.user)})


@api_view(["POST"])
def find(request):
    """{key}: search YouTube for the word once, and read the subtitles of the videos it finds.
    A word someone else searched for has its videos already; asking again searches again."""
    user = request.user
    if not heard.enabled(user):
        return _off()
    key = str(request.data.get("key", ""))
    term = _term(key)
    word = Word.objects.of(user).filter(key=key).first()
    lemma = (term or word).lemma if (term or word) else _from_entry(key)["lemma"]
    if not lemma:
        return Response({"error": "kotoba doesn't know that word."}, status=400)
    ch, made = Channel.objects.get_or_create(kind=Channel.Kind.SEARCH, term_key=key,
                                             defaults={"url": f"ytsearch:{key}", "title": lemma[:200]})
    if not made and ch.followers.filter(pk=user.pk).exists():
        ch.checked_at, ch.error = None, ""
        ch.save(update_fields=["checked_at", "error"])
    ch.followers.add(user)
    worker.kick()
    return Response({"finding": _finding(key, user)})


def _line(request, pk) -> Line:
    return get_object_or_404(Line.objects.filter(video__in=heard.videos(request.user)).select_related("video"), pk=pk)


@api_view(["GET"])
def line_context(request, pk):
    """?key=&radius=: the lines around one, as the video goes."""
    try:
        radius = min(int(request.query_params.get("radius", 6)), 30)
    except ValueError:
        radius = 6
    return Response({"lines": heard.context(_line(request, pk), request.user, radius, request.query_params.get("key") or None)})


def _video_json(v: Video, lines: int, kept: int, source: int | None) -> dict:
    return {"id": v.id, "yt_id": v.yt_id, "title": v.title, "uploader": v.uploader, "duration": v.duration,
            "published": v.published, "url": v.url(), "gone": v.gone_at is not None, "lines": lines, "kept": kept, "source": source}


# the list's orders, the newest first by default; a video with no date or length goes last
VIDEO_ORDERS = {
    "new": (F("published").desc(nulls_last=True), F("id").desc()),
    "old": (F("published").asc(nulls_last=True), F("id").asc()),
    "short": (F("duration").asc(nulls_last=True), F("published").desc(nulls_last=True)),
    "long": (F("duration").desc(nulls_last=True), F("published").desc(nulls_last=True)),
}
# lengths to pick from, in seconds: under 10 minutes, 10 to 30, over 30
VIDEO_LENGTHS = {"short": (None, 600), "mid": (600, 1800), "long": (1800, None)}


@api_view(["GET"])
def video_list(request):
    """?channel=<id>,<id>,found&length=short|mid|long&order=new|old|short|long&q=&offset=&limit=:
    the videos with Japanese subtitles you hear lines from, newest first, and the channels to pick
    from (any number of them; found: the ones Find more turned up). q finds a
    video by its title or channel, or by something said in it: such a video comes with the first
    line that says it and how many do."""
    user, p = request.user, request.query_params
    try:
        offset, limit = max(int(p.get("offset", 0)), 0), min(max(int(p.get("limit", 30)), 1), 100)
    except ValueError:
        return Response({"error": "offset and limit are numbers"}, status=400)
    followed = Channel.objects.filter(followers=user)
    channels = followed.exclude(kind=Channel.Kind.SEARCH)
    ok = Video.objects.filter(subs=Video.Subs.OK)
    found = ok.filter(channels__in=followed.filter(kind=Channel.Kind.SEARCH)).exclude(channels__in=channels)
    picks = [x for x in p.get("channel", "").split(",") if x]
    if picks:
        either = Q()
        if ids := [int(x) for x in picks if x.isdigit()]:
            either |= Q(id__in=ok.filter(channels__in=channels.filter(pk__in=ids)).values("id"))
        if "found" in picks:
            either |= Q(id__in=found.values("id"))
        mine = ok.filter(either) if either else ok.none()
    else:
        mine = ok.filter(channels__in=followed)
    if (length := p.get("length", "")) in VIDEO_LENGTHS:
        low, high = VIDEO_LENGTHS[length]
        mine = mine.filter(duration__isnull=False)
        if low is not None:
            mine = mine.filter(duration__gte=low)
        if high is not None:
            mine = mine.filter(duration__lt=high)
    q = p.get("q", "").strip()
    if q:
        said_in = Line.objects.filter(text__icontains=q).values("video")
        mine = mine.filter(Q(title__icontains=q) | Q(uploader__icontains=q) | Q(id__in=said_in))
    videos = Video.objects.filter(id__in=mine.values("id")).annotate(n=Count("lines")).order_by(*VIDEO_ORDERS.get(p.get("order", ""), VIDEO_ORDERS["new"]))
    total = videos.count()
    page = list(videos[offset:offset + limit])
    ids = [v.id for v in page]
    kept = dict(Line.sentences.through.objects.filter(line__video__in=ids, sentence__source__owner=user)
                .values("line__video").annotate(n=Count("id")).values_list("line__video", "n"))
    sources = heard.video_sources(user, ids)
    said = {}
    if q:
        for ln in Line.objects.filter(video__in=ids, text__icontains=q).order_by("video", "position").only("id", "video", "text"):
            hit = said.setdefault(ln.video_id, {"lines": 0, "line": {"id": ln.id, "text": ln.text}})
            hit["lines"] += 1
    by_channel = dict(Video.channels.through.objects.filter(channel__in=channels, video__subs=Video.Subs.OK)
                      .values("channel").annotate(n=Count("video")).values_list("channel", "n"))
    return Response({"enabled": heard.enabled(user), "total": total, "reading": _reading(),
                     "channels": [{"id": c.id, "title": c.title or c.url, "videos": by_channel.get(c.id, 0)} for c in channels],
                     "found": found.distinct().count(),
                     "videos": [{**_video_json(v, v.n, kept.get(v.id, 0), sources.get(v.id)), "said": said.get(v.id)}
                                for v in page]})


@api_view(["GET"])
def video(request, pk):
    """A video and every line of it in order, with the ones you kept (as your sentences)."""
    user = request.user
    # a channel you stopped following still leads from the source you kept its lines in
    v = get_object_or_404(Video.objects.filter(Q(channels__followers=user) | Q(sources__owner=user)).distinct(), pk=pk)
    lines = list(v.lines.all())
    kept = dict(Line.sentences.through.objects.filter(line__video=v, sentence__source__owner=user)
                .values_list("line_id", "sentence_id"))
    channels = v.channels.filter(followers=user).exclude(kind=Channel.Kind.SEARCH)
    return Response({**_video_json(v, len(lines), len(kept), heard.video_sources(user, [v.id]).get(v.id)),
                     "subs": v.subs, "here": heard.audio_path(v) is not None,
                     "channels": [{"id": c.id, "title": c.title or c.url} for c in channels],
                     "lines": [{"id": ln.id, "text": ln.text, "furigana": ln.furigana, "start": ln.start, "end": ln.end,
                                "sentence": kept.get(ln.id)} for ln in lines]})


@api_view(["GET", "POST"])
def video_audio(request, pk):
    """The video's audio, for playing its lines from (with Range). It's fetched from YouTube the
    first time, which takes a few seconds; POST does just that and says when it's done."""
    video = get_object_or_404(heard.videos(request.user).distinct(), pk=pk)
    if not heard.audio_path(video) and not heard.enabled(request.user):
        return _off()
    try:
        path = heard.fetch(video)
    except ytdlp.YtError as e:
        gone = e.kind in ("gone", "members")
        return Response({"error": "This video isn't on YouTube any more." if gone else f"Couldn't fetch it: {e}",
                         "gone": gone}, status=410 if gone else 502)
    if request.method == "POST":
        return Response({"ready": True})
    return ranged_file(request, str(path))


@api_view(["POST"])
def line_keep(request, pk):
    """Make the line one of your sentences, in the inbox under its video."""
    line = _line(request, pk)
    sentence = heard.keep(line, request.user)
    return Response({"sentence": sentence.id, "source": sentence.source_id,
                     "audio": heard.audio_state(line.video, sentence.source_id)}, status=201)


# --- a word that may not be one of yours ------------------------------------------------------

def _from_entry(key: str) -> dict:
    """A dictionary word as it's usually written, from its key alone."""
    m = re.fullmatch(r"j:(\d+)", key)
    if m:
        found = dictionary.entry(int(m[1]))
        if found:
            e = found[0]
            usually_kana = bool(e["senses"]) and "uk" in e["senses"][0]["misc"]
            kana = e["kana"][0]["text"] if e["kana"] else ""
            lemma = kana if usually_kana or not e["kanji"] else e["kanji"][0]["text"]
            return {"lemma": lemma, "reading": romanize._hira(kana), "entry": e["id"], "entries": found}
        return {"lemma": "", "reading": "", "entry": int(m[1]), "entries": []}
    m = re.fullmatch(r"m:([^/]+)/(.*)", key)
    if m:
        return {"lemma": m[1], "reading": m[2], "entry": None,
                "entries": dictionary.entries([m[1]], m[2]) if dictionary.path().exists() else []}
    return {"lemma": "", "reading": "", "entry": None, "entries": []}


@api_view(["GET"])
def term(request, key):
    """A word by its dictionary key, met or not: how it's written and read, what it means, and
    the word page when it's in your sentences."""
    found = _from_entry(key)
    t = _term(key)
    w = words.with_counts(Word.objects.of(request.user).filter(key=key)).first()
    lemma = (w or t).lemma if (w or t) else found["lemma"]
    reading = (w or t).reading if (w or t) else found["reading"]
    if not lemma:
        return Response({"error": "kotoba doesn't know that word."}, status=404)
    entries = found["entries"] or (dictionary.entries([lemma], reading) if dictionary.path().exists() else [])
    return Response({"key": key, "lemma": lemma, "reading": reading, "romaji": dictionary._romaji(reading) if reading else "",
                     "entries": entries, "dictionary": dictionary.status()["state"],
                     "word": {"id": w.id, "sentences": w.sentences, "status": words.status(w)} if w and w.sentences else None})


@api_view(["GET"])
def search(request):
    """?q=: lines heard on YouTube with the words a search finds (or its text), and those words."""
    q, user = request.query_params.get("q", "").strip()[:200], request.user
    if not q or not heard.enabled(user):
        return Response({"enabled": heard.enabled(user), "terms": [], "lines": [], "total": 0})
    heard_here = heard.videos(user)
    f = fold(q)
    cond = Q(search__contains=f) | Q(uses__surface__contains=q)
    latin = re.search("[a-z]", f)
    rq = romanize.key(q) if latin else ""
    if len(rq) >= 2:
        cond |= Q(search__contains=rq)
    terms = set(Term.objects.filter(cond).values_list("id", flat=True))
    if latin and len(q) >= 3:
        entries = dict(Term.objects.exclude(entry=None).values_list("entry", "id"))
        terms |= {entries[e] for e in dictionary.meaning_matches(entries, q)}
    exact = [t for t in Term.objects.filter(id__in=terms).annotate(
        n=Count("uses__line", filter=Q(uses__line__video__in=heard_here), distinct=True)) if t.n]
    exact.sort(key=lambda t: (fold(t.lemma) != f and t.reading != f, -t.n, t.lemma))
    by_terms = TermUse.objects.filter(term__in=[t.id for t in exact[:20]]).values("line_id")
    lines = (Line.objects.filter(Q(text__contains=q) | Q(id__in=by_terms), video__in=heard_here, video__gone_at__isnull=True)
             .exclude(sentences__source__owner=user).select_related("video").order_by("-video__published", "position"))
    total = lines.count()
    top = exact[0].key if exact else None
    page = list(lines[:6])
    spans = heard.spans_for(top, [l.id for l in page]) if top else {}
    own = heard.mine(user, page)
    return Response({"enabled": True, "total": total,
                     "terms": [{"key": t.key, "lemma": t.lemma, "reading": t.reading, "lines": t.n} for t in exact[:8]],
                     "lines": [heard.line_json(l, own, spans=spans.get(l.id, [])) for l in page]})
