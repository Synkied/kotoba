"""Chat with one of the LLMs saved on the Add-ons page (the translators). Each request carries
the conversation whole; given a conversation's id, kotoba keeps it there, to read again later.
A message may carry images (data URLs, scaled down by the browser) for a model that reads them."""
import base64
import re

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import translate
from .models import Conversation
from .serializers import Owned

MAX_TURNS = 40          # the latest turns sent along; older ones fall out of the model's view
MAX_CHARS = 8000        # per message
MAX_IMAGES = 4          # per message
SENT_IMAGES = 8         # the latest images sent along; older ones become a line saying one was there
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's limit for one image
TITLE_CHARS = 60        # a chat is named after the start of its first message until renamed
_DATA_URL = re.compile(r"data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+=*)")


def _system(user) -> str:
    name = translate.LANGUAGES[translate.language(user)]
    return ("You are a conversation partner and tutor inside kotoba, a study app for someone learning Japanese. "
            f"Their own language is {name}. When they write in Japanese, answer in natural Japanese they can follow, "
            f"then, only if they made mistakes, add a short note in {name} on how to say it better. Otherwise answer "
            f"in {name}, quoting Japanese where it helps. When they share an image (a game, a page, a sign, an app), "
            "read the Japanese in it and help with that. Keep answers short unless asked for more; Markdown is fine.")


def _images(raw) -> list[tuple[str, str]]:
    """A message's images as (media type, base64), checked."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_IMAGES:
        raise ValueError(f"Send at most {MAX_IMAGES} images at once.")
    out = []
    for url in raw:
        m = _DATA_URL.fullmatch(url) if isinstance(url, str) else None
        if not m:
            raise ValueError("Images can be PNG, JPEG, WebP or GIF.")
        if len(m[2]) * 3 // 4 > MAX_IMAGE_BYTES:
            raise ValueError("An image can be at most 5 MB.")
        try:
            base64.b64decode(m[2], validate=True)
        except ValueError:
            raise ValueError("kotoba couldn't read one of the images.") from None
        out.append((m[1], m[2]))
    return out


def _content(turn: dict, kind: str):
    """A turn as the model's API takes it: plain text, or its images then its text."""
    if not turn["images"]:
        return turn["content"]
    if kind == "anthropic":
        parts = [{"type": "image", "source": {"type": "base64", "media_type": t, "data": b}} for t, b in turn["images"]]
    else:
        parts = [{"type": "image_url", "image_url": {"url": f"data:{t};base64,{b}"}} for t, b in turn["images"]]
    if turn["content"]:
        parts.append({"type": "text", "text": turn["content"]})
    return parts


def _clean(raw) -> list[dict]:
    """The whole conversation, checked, as it is kept: role, content, images (data URLs) on what the
    person wrote, the model's name on a reply. Empty turns fall out."""
    if not isinstance(raw, list):
        raise ValueError("kotoba couldn't read that conversation.")
    turns = []
    for m in raw:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str):
            raise ValueError("kotoba couldn't read that conversation.")
        text = m["content"].strip()
        if len(text) > MAX_CHARS:
            raise ValueError(f"A message can be at most {MAX_CHARS:,} characters.")
        turn = {"role": m["role"], "content": text}
        if m["role"] == "user":
            images = _images(m.get("images"))
            if images:
                turn["images"] = [f"data:{t};base64,{b}" for t, b in images]
        elif isinstance(m.get("name"), str) and m["name"].strip():
            turn["name"] = m["name"].strip()[:200]
        if text or turn.get("images"):
            turns.append(turn)
    return turns


def _turns(kept: list[dict]) -> list[dict]:
    """What goes to the model: the latest turns of a checked conversation, the person first and last."""
    turns = [{"role": m["role"], "content": m["content"], "images": [tuple(u[5:].split(";base64,")) for u in m.get("images", [])]}
             for m in kept[-MAX_TURNS:]]
    while turns and turns[0]["role"] != "user":  # every model wants the person to speak first
        turns.pop(0)
    if not turns or turns[-1]["role"] != "user":
        raise ValueError("Write something to send.")
    # every image is sent again with each message: only the latest go, the older ones are named
    seen = 0
    for turn in reversed(turns):
        seen += len(turn["images"])
        if seen > SENT_IMAGES:
            n = len(turn["images"])
            turn["content"] = f"({'an image' if n == 1 else f'{n} images'} shared earlier)\n{turn['content']}".strip()
            turn["images"] = []
    return turns


def _title(kept: list[dict]) -> str:
    """The start of the first message's first line, else what it shared."""
    first = next((m for m in kept if m["role"] == "user"), None)
    if not first:
        return ""
    line = next((l.strip() for l in first["content"].splitlines() if l.strip()), "")
    if not line:
        return "An image" if len(first.get("images", [])) == 1 else "Images"
    return line if len(line) <= TITLE_CHARS else line[:TITLE_CHARS - 1].rstrip() + "…"


def _keep(convo: Conversation, kept: list[dict]):
    """The conversation as it now stands; carrying on with an archived chat brings it back."""
    convo.messages = kept
    convo.title = convo.title or _title(kept)
    convo.archived = False
    convo.updated_at = timezone.now()
    convo.save()


@api_view(["GET", "POST"])
def chat(request):
    """GET: the LLMs there are to chat with, and the one in use. POST {llm, messages, conversation?}:
    its reply. With a conversation's id, what you wrote is kept there at once and the reply once it
    comes, unless the chat changed meanwhile (you stopped and wrote again)."""
    user = request.user
    llms = translate.translators(user)
    if request.method == "GET":
        return Response({"llms": [translate.public(t) for t in llms], "active": translate.active_id(user)})
    cfg = next((t for t in llms if t["id"] == request.data.get("llm")), None) or translate.active(user)
    if not cfg:
        return Response({"error": "No LLM to chat with yet: add one on the Add-ons page."}, status=400)
    convo = None
    if request.data.get("conversation") is not None:
        convo = get_object_or_404(Conversation.objects.of(user), pk=request.data["conversation"])
    try:
        raw = request.data.get("messages")
        if not isinstance(raw, list) or not raw:
            raise ValueError("Write something to send.")
        kept = _clean(raw)
        turns = _turns(kept)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    if convo:
        _keep(convo, kept)
        asked_at = convo.updated_at
    messages = [{"role": t["role"], "content": _content(t, cfg["kind"])} for t in turns]
    try:
        reply = translate._converse(cfg, _system(user), messages, max_tokens=4000, temperature=0.7)
    except translate.TranslateError as e:
        error = str(e)
        if any(t["images"] for t in turns) and cfg["kind"] != "anthropic":
            error += " If this model can't read images, choose one that can (a vision model such as qwen2.5vl or gemma3)."
        return Response({"error": error}, status=503)
    reply = translate._THINK.sub("", reply).strip()
    if not reply:
        return Response({"error": "The model answered with nothing. Try again, or try another model."}, status=503)
    out = {"reply": reply, "llm": cfg["id"], "name": cfg["name"]}
    if convo:
        kept.append({"role": "assistant", "content": reply, "name": cfg["name"]})
        now = timezone.now()
        if Conversation.objects.filter(pk=convo.pk, updated_at=asked_at).update(messages=kept, updated_at=now):
            convo.messages, convo.updated_at = kept, now
        out["conversation"] = ConversationSerializer(convo).data
    return Response(out)


class ConversationSerializer(Owned, serializers.ModelSerializer):
    """In the list, a chat without its turns; opened, with them. Turns are written by chatting,
    or once on creating a chat (a conversation brought over from the browser)."""

    messages = serializers.JSONField(required=False)

    class Meta:
        model = Conversation
        fields = ["id", "title", "pinned", "archived", "messages", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_fields(self):
        fields = super().get_fields()
        view = self.context.get("view")
        if view and view.action == "list":
            fields.pop("messages")
        elif self.instance is not None and view and view.action in ("update", "partial_update"):
            fields["messages"].read_only = True
        return fields

    def validate_title(self, value):
        value = value.strip()
        if not value and self.instance is not None:
            raise serializers.ValidationError("Give this chat a name.")
        return value

    def validate_messages(self, value):
        try:
            return _clean(value)
        except ValueError as e:
            raise serializers.ValidationError(str(e)) from None

    def create(self, data):
        data["title"] = data.get("title") or _title(data.get("messages", []))
        return super().create(data)


class ConversationViewSet(viewsets.ModelViewSet):
    """The chats kept, latest first. ?archived=true lists the archived ones instead."""

    serializer_class = ConversationSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Conversation.objects.of(self.request.user)
        if self.action == "list":
            qs = qs.filter(archived=self.request.query_params.get("archived") == "true").defer("messages")
        return qs
