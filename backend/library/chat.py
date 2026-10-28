"""Chat with one of the LLMs saved on the Add-ons page (the translators). The conversation
lives in the browser: each request carries it whole, and kotoba keeps nothing of it.
A message may carry images (data URLs, scaled down by the browser) for a model that reads them."""
import base64
import re

from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import translate

MAX_TURNS = 40          # the latest turns sent along; older ones fall out of the model's view
MAX_CHARS = 8000        # per message
MAX_IMAGES = 4          # per message
SENT_IMAGES = 8         # the latest images sent along; older ones become a line saying one was there
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's limit for one image
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


def _turns(raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("Write something to send.")
    turns = []
    for m in raw[-MAX_TURNS:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str):
            raise ValueError("kotoba couldn't read that conversation.")
        text = m["content"].strip()
        if len(text) > MAX_CHARS:
            raise ValueError(f"A message can be at most {MAX_CHARS:,} characters.")
        images = _images(m.get("images")) if m["role"] == "user" else []
        if text or images:
            turns.append({"role": m["role"], "content": text, "images": images})
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


@api_view(["GET", "POST"])
def chat(request):
    """GET: the LLMs there are to chat with, and the one in use. POST {llm, messages}: its reply."""
    user = request.user
    llms = translate.translators(user)
    if request.method == "GET":
        return Response({"llms": [translate.public(t) for t in llms], "active": translate.active_id(user)})
    cfg = next((t for t in llms if t["id"] == request.data.get("llm")), None) or translate.active(user)
    if not cfg:
        return Response({"error": "No LLM to chat with yet: add one on the Add-ons page."}, status=400)
    try:
        turns = _turns(request.data.get("messages"))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
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
    return Response({"reply": reply, "llm": cfg["id"], "name": cfg["name"]})
