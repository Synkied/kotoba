"""Sentence translations by an LLM: a local one by default (Ollama, llama.cpp or any
OpenAI-compatible server), or Claude.

Translators are set up on the Add-ons page and saved in the data folder's
settings.json, API keys included; one is active at a time. The KOTOBA_LLM_* variables
describe one more, "From the environment", which is the default.

Each sentence is translated with its neighbours as context, so a reply like
「はい、そうです。」 comes out in the sense the conversation gives it. Results are
kept per language in Sentence.translations; a hand-edited one is never replaced
unless asked."""
import ipaddress
import json
import os
import re
import uuid
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

LANGUAGES = {
    "en": "English", "fr": "French", "es": "Spanish", "de": "German", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "ru": "Russian", "uk": "Ukrainian",
    "tr": "Turkish", "ar": "Arabic", "hi": "Hindi", "id": "Indonesian", "vi": "Vietnamese",
    "th": "Thai", "ko": "Korean", "zh": "Chinese (Simplified)",
}
CLAUDE_MODEL = "claude-opus-5-5"
TIMEOUT = 120  # seconds; a local model may be loading into memory on the first call

_SETTINGS = settings.DATA_DIR / "settings.json"
_THINK = re.compile(r"<think>.*?</think>", re.S)


class TranslateError(Exception):
    pass


# --- settings.json -------------------------------------------------------------------

def _load() -> dict:
    try:
        data = json.loads(_SETTINGS.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict):
    _SETTINGS.write_text(json.dumps(data, indent=2))
    try:
        _SETTINGS.chmod(0o600)  # it holds API keys
    except OSError:
        pass


# --- the chosen language ---------------------------------------------------------

def language() -> str:
    code = _load().get("translate_to", "en")
    return code if code in LANGUAGES else "en"


def set_language(code: str):
    if code not in LANGUAGES:
        raise ValueError(f"kotoba can't translate into {code!r}.")
    _save({**_load(), "translate_to": code})


# --- translators ----------------------------------------------------------------------

KINDS = {  # what each kind of translator asks for
    "ollama": "Ollama", "llamacpp": "llama.cpp", "anthropic": "Claude", "openai": "OpenAI-compatible API",
}
ENV_ID = "env"


def _host() -> str:
    """Where a server on this machine is: host.docker.internal from inside Docker."""
    docker = os.path.exists("/.dockerenv") or "host.docker.internal" in settings.LLM["url"]
    return "host.docker.internal" if docker else "127.0.0.1"


def defaults() -> dict:
    return {"ollama": f"http://{_host()}:11434/v1", "llamacpp": f"http://{_host()}:8080/v1",
            "openai": "", "anthropic": "anthropic"}


def _from_env() -> dict:
    url = settings.LLM["url"]
    return {"id": ENV_ID, "kind": "anthropic" if url == "anthropic" else "openai", "name": "From the environment",
            "url": url, "model": settings.LLM["model"], "key": settings.LLM["key"]}


def translators() -> list[dict]:
    """The environment's translator first, then the saved ones. These carry the keys."""
    saved = [t for t in _load().get("translators", []) if isinstance(t, dict) and t.get("kind") in KINDS]
    return [_from_env(), *saved]


def active_id() -> str:
    chosen = _load().get("translator", ENV_ID)
    return chosen if any(t["id"] == chosen for t in translators()) else ENV_ID


def _active() -> dict:
    chosen = active_id()
    return next(t for t in translators() if t["id"] == chosen)


def public(t: dict) -> dict:
    """A translator as the browser sees it: never the key itself."""
    key = t.get("key") or ""
    return {"id": t["id"], "kind": t["kind"], "name": t["name"], "url": t["url"], "model": t["model"],
            "key_set": bool(key), "key_hint": f"…{key[-4:]}" if len(key) >= 12 else ("set" if key else ""),
            "cloud": t["kind"] == "anthropic" or not _local(t["url"]), "builtin": t["id"] == ENV_ID}


def _clean_config(data: dict, old: dict | None = None) -> dict:
    """Validate a translator from the form. An empty key keeps the saved one, unless the
    address changed: a key only ever goes to the server it was given for."""
    old = old or {}
    kind = data.get("kind", old.get("kind"))
    if kind not in KINDS:
        raise ValueError("Choose what kind of translator this is.")
    name = " ".join(str(data.get("name", old.get("name", ""))).split())[:60] or KINDS[kind]
    model = str(data.get("model", old.get("model", ""))).strip()[:200]
    if kind == "anthropic":
        url = "anthropic"
    else:
        url = str(data.get("url", old.get("url", "")) or defaults()[kind]).strip().rstrip("/")
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("The address should look like http://127.0.0.1:11434/v1.")
    key = str(data.get("key") or "").strip()
    if not key and old.get("kind") == kind and old.get("url") == url:
        key = old.get("key", "")
    if kind == "openai" and not model:
        raise ValueError("Name the model to use, e.g. gpt-5-mini or a model from your provider's list.")
    if kind == "anthropic" and not key and not os.environ.get("ANTHROPIC_API_KEY"):
        raise ValueError("Claude needs an API key (console.anthropic.com).")
    return {"kind": kind, "name": name, "url": url, "model": model, "key": key}


def add_translator(data: dict, activate: bool = False) -> dict:
    t = {"id": uuid.uuid4().hex[:8], **_clean_config(data)}
    store = _load()
    store["translators"] = [*store.get("translators", []), t]
    if activate:
        store["translator"] = t["id"]
    _save(store)
    return t


def _saved(tid: str) -> dict:
    found = next((t for t in _load().get("translators", []) if t.get("id") == tid), None)
    if not found:
        raise KeyError(tid)
    return found


def update_translator(tid: str, data: dict, activate: bool = False) -> dict:
    old = _saved(tid)
    t = {"id": tid, **_clean_config(data, old)}
    store = _load()
    store["translators"] = [t if x.get("id") == tid else x for x in store.get("translators", [])]
    if activate:
        store["translator"] = tid
    _save(store)
    return t


def remove_translator(tid: str):
    _saved(tid)
    store = _load()
    store["translators"] = [x for x in store.get("translators", []) if x.get("id") != tid]
    if store.get("translator") == tid:
        store["translator"] = ENV_ID
    _save(store)


def activate(tid: str):
    if not any(t["id"] == tid for t in translators()):
        raise KeyError(tid)
    _save({**_load(), "translator": tid})


def draft(data: dict) -> dict:
    """A translator from the form, not saved yet, for Test: an unchanged key comes from its saved copy."""
    old = None
    if data.get("id") and data["id"] != ENV_ID:
        try:
            old = _saved(data["id"])
        except KeyError:
            pass
    return {"id": data.get("id") or "draft", **_clean_config(data, old)}


# --- the model ---------------------------------------------------------------------

def _openai(cfg: dict, path: str, body: dict | None = None, timeout: float = TIMEOUT) -> dict:
    headers = {"Content-Type": "application/json"}
    if cfg["key"]:
        headers["Authorization"] = f"Bearer {cfg['key']}"
    req = urllib.request.Request(cfg["url"] + path, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code in (401, 403):
            raise TranslateError(f"{cfg['url']} refused the API key ({e.code}). Check it on the Add-ons page.") from e
        raise TranslateError(f"The translation server answered {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise TranslateError(f"No translation server at {cfg['url']} ({getattr(e, 'reason', e)}). "
                             "Start Ollama or llama-server, or choose another translator on the Add-ons page.") from e


def _models(cfg: dict, timeout: float = 5) -> list[str]:
    return [m["id"] for m in _openai(cfg, "/models", timeout=timeout).get("data") or [] if isinstance(m, dict) and m.get("id")]


_first_model: dict[str, str] = {}  # url -> the model it listed first, so each sentence isn't a second request


def _model(cfg: dict) -> str:
    if cfg["model"]:
        return cfg["model"]
    if cfg["kind"] == "anthropic":
        return CLAUDE_MODEL
    if cfg["url"] in _first_model:
        return _first_model[cfg["url"]]
    models = _models(cfg)
    if not models:
        raise TranslateError("The translation server has no models. Pull one (ollama pull qwen2.5:7b) "
                             "or name one on the Add-ons page.")
    _first_model[cfg["url"]] = models[0]
    return models[0]


def _local(url: str) -> bool:
    """Whether sentences stay on this machine or network (Tailscale included)."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if host in ("localhost", "host.docker.internal") or host.endswith((".local", ".lan", ".ts.net")) or "." not in host:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip in ipaddress.ip_network("100.64.0.0/10")


def status(cfg: dict | None = None) -> dict:
    """Whether a translator (the active one by default) answers; cheap enough for the Add-ons
    page. `models` lists what an OpenAI-compatible server offers, for the form."""
    cfg = cfg or _active()
    out = {"url": cfg["url"], "model": cfg["model"], "cloud": cfg["kind"] == "anthropic" or not _local(cfg["url"]),
           "ready": False, "error": None, "models": []}
    if cfg["kind"] == "anthropic":
        out["model"] = out["model"] or CLAUDE_MODEL
        try:
            import anthropic  # noqa: F401
            out["ready"] = True
        except ImportError:
            out["error"] = "Claude needs the claude extra: make install EXTRAS=\"whisper voice claude\"."
        return out
    _first_model.pop(cfg["url"], None)  # the Add-ons page looks again, e.g. after a new model was pulled
    try:
        out["models"] = _models(cfg)[:100]
        out["model"] = _model(cfg)
        out["ready"] = True
    except TranslateError as e:
        out["error"] = str(e)
    return out


def _prompt(text: str, before: list[str], after: list[str], lang: str) -> tuple[str, str]:
    system = (f"You translate Japanese into natural {LANGUAGES[lang]} for someone learning Japanese. "
              "Keep the meaning, tone and politeness of the original; don't add explanations, "
              "romanization, notes or quotation marks. Reply with the translation only.")
    parts = []
    if before or after:
        parts.append("Context (do not translate):")
        parts += [f"  {line}" for line in before]
        parts.append("  >>> the sentence <<<")
        parts += [f"  {line}" for line in after]
        parts.append("")
    parts.append(f"Translate into {LANGUAGES[lang]}:\n{text}")
    return system, "\n".join(parts)


def _ask(cfg: dict, system: str, user: str) -> str:
    if cfg["kind"] == "anthropic":
        try:
            import anthropic
        except ImportError as e:
            raise TranslateError("Claude needs the claude extra: make install EXTRAS=\"whisper voice claude\".") from e
        client = anthropic.Anthropic(api_key=cfg["key"] or None, timeout=TIMEOUT)
        try:
            response = client.beta.messages.create(
                model=_model(cfg), max_tokens=2000, system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            )
        except anthropic.AuthenticationError as e:
            raise TranslateError("Claude rejected the API key. Check it on the Add-ons page.") from e
        except anthropic.NotFoundError as e:
            raise TranslateError(f"Claude has no model {_model(cfg)!r}. Check the model on the Add-ons page.") from e
        except anthropic.RateLimitError as e:
            raise TranslateError("Claude is rate limiting requests. Try again in a minute.") from e
        except anthropic.APIStatusError as e:
            raise TranslateError(f"Claude answered {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise TranslateError("Couldn't reach Claude. Check the network connection.") from e
        if response.stop_reason == "refusal":
            raise TranslateError("Claude declined to translate this sentence.")
        return "".join(b.text for b in response.content if b.type == "text")
    body = {
        "model": _model(cfg), "temperature": 0.2, "stream": False,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    # a thinking model would reason for hundreds of tokens before each one-line translation:
    # ask local servers not to (Ollama reads reasoning_effort, llama-server the template kwarg)
    quiet = {"reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False}} if _local(cfg["url"]) else {}
    try:
        data = _openai(cfg, "/chat/completions", {**body, **quiet})
    except TranslateError as e:
        if not quiet or "answered 4" not in str(e):
            raise
        data = _openai(cfg, "/chat/completions", body)  # a server that rejects those switches
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise TranslateError("The translation server sent an answer kotoba couldn't read.") from e


def _clean(reply: str) -> str:
    text = _THINK.sub("", reply).strip()  # reasoning models (Qwen3, DeepSeek-R1) think out loud
    text = re.sub(r"^(translation|traduction)\s*:\s*", "", text, flags=re.I)
    if len(text) > 1 and text[0] in "\"“«「" and text[-1] in "\"”»」":
        text = text[1:-1].strip()
    return text


def translate(sentence, lang: str | None = None, force: bool = False) -> str:
    """Translate one sentence (and save it). Keeps an existing translation unless `force`."""
    lang = lang or language()
    if lang not in LANGUAGES:
        raise TranslateError(f"kotoba can't translate into {lang!r}.")
    if sentence.translations.get(lang) and not force:
        return sentence.translations[lang]
    siblings = list(sentence.source.sentences.order_by("position").values_list("id", "text"))
    at = next((i for i, (pk, _) in enumerate(siblings) if pk == sentence.pk), 0)
    before = [t for _, t in siblings[max(0, at - 2):at]]
    after = [t for _, t in siblings[at + 1:at + 2]]
    text = _clean(_ask(_active(), *_prompt(sentence.text, before, after, lang)))
    if not text:
        raise TranslateError("The model answered with nothing. Try again, or try another model.")
    sentence.translations = {**sentence.translations, lang: text}
    type(sentence).objects.filter(pk=sentence.pk).update(translations=sentence.translations)
    return text


# --- explaining a selected stretch ---------------------------------------------------

_explained: dict[tuple, dict] = {}  # the same question again doesn't cost a second call
_BULLET = re.compile(r"^\s*(?:[-*•・]|\d+[.)])\s*")


def _explain_prompt(text: str, context: str, lang: str) -> tuple[str, str]:
    name = LANGUAGES[lang]
    system = (f"You help someone learning Japanese understand a passage they selected. Answer in {name}. "
              f"On the first line, give a natural {name} translation of the selected passage only, "
              "in the sense its context gives it. Then leave a blank line and explain, in at most five short lines "
              "each starting with \"- \", the words, grammar and nuance that make it mean that "
              "(quote the Japanese you explain). No romanization, no preamble, no closing remarks.")
    user = f"Context:\n{context}\n\nSelected passage:\n{text}" if context and context != text else f"Selected passage:\n{text}"
    return system, user


def _parse_explanation(reply: str) -> dict:
    lines = [line.strip() for line in _THINK.sub("", reply).strip().splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        raise TranslateError("The model answered with nothing. Try again, or try another model.")
    translation = _clean(_BULLET.sub("", lines[0]).strip("*").strip())
    notes = [n for n in (_BULLET.sub("", line).strip() for line in lines[1:]) if n]
    return {"translation": translation, "notes": notes}


def explain(text: str, context: str = "", lang: str | None = None, force: bool = False) -> dict:
    """What `text`, selected inside `context`, means: a translation and a few notes."""
    lang = lang or language()
    if lang not in LANGUAGES:
        raise TranslateError(f"kotoba can't translate into {lang!r}.")
    cfg = _active()
    key = (cfg["id"], cfg["url"], cfg["model"], lang, text, context)
    if key not in _explained or force:
        if len(_explained) >= 200:
            _explained.pop(next(iter(_explained)))
        _explained[key] = _parse_explanation(_ask(cfg, *_explain_prompt(text, context, lang)))
    return {**_explained[key], "to": lang, "name": LANGUAGES[lang]}
