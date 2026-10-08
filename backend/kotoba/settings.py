"""kotoba settings. A personal, local-first service: it runs on your own machine or a
Raspberry Pi reached over Tailscale, so there are no accounts; the Origin check in
library.middleware keeps other websites from writing to it."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _read_env_file(path: Path):
    """KEY=value lines from the repository's .env (the same file Docker Compose reads).
    Variables already set in the environment win."""
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].strip()
        os.environ.setdefault(key.strip(), value)


_read_env_file(BASE_DIR.parent / ".env")
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

SECRET_KEY = os.environ.get("KOTOBA_SECRET_KEY", "kotoba-local-only-not-secret")
DEBUG = os.environ.get("KOTOBA_DEBUG", "1") == "1"
# Extra host names (e.g. pi.tail1234.ts.net) as a comma-separated list
ALLOWED_HOSTS = ["127.0.0.1", "localhost", *filter(None, os.environ.get("KOTOBA_HOSTS", "").split(","))]

# Where kotoba keeps its database and files
DATA_DIR = Path(os.environ.get("KOTOBA_DATA") or
                Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "kotoba")
DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_ROOT = DATA_DIR / "files"
MEDIA_URL = "/files/"

# Whisper for scoring and transcription (the `whisper` extra). Empty values pick what
# suits the machine: large-v3 / float16 on an NVIDIA GPU, large-v3-turbo / int8 on a CPU.
WHISPER = {k: v for k, v in {
    "model": os.environ.get("KOTOBA_WHISPER_MODEL", ""),
    "device": os.environ.get("KOTOBA_WHISPER_DEVICE", ""),
    "compute_type": os.environ.get("KOTOBA_WHISPER_COMPUTE", ""),
}.items() if v}
# A VOICEVOX / AivisSpeech engine for more voices (AivisSpeech uses port 10101)
VOICEVOX_URL = os.environ.get("KOTOBA_VOICEVOX", "http://127.0.0.1:50021").rstrip("/")
# The LLM that translates sentences. Any OpenAI-compatible server: Ollama (the default),
# llama.cpp's llama-server (http://127.0.0.1:8080/v1), LM Studio, vLLM, or OpenAI itself
# with a key. "anthropic" uses Claude (the `claude` extra; the key can also come from
# ANTHROPIC_API_KEY). An empty model takes the first one the server lists.
LLM = {
    "url": os.environ.get("KOTOBA_LLM_URL", "http://127.0.0.1:11434/v1").rstrip("/"),
    "model": os.environ.get("KOTOBA_LLM_MODEL", ""),
    "key": os.environ.get("KOTOBA_LLM_KEY", ""),
}

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "library",
    "speech",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "library.middleware.SameOriginWrites",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "kotoba.urls"
TEMPLATES = []
WSGI_APPLICATION = "kotoba.wsgi.application"

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "kotoba.db"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("TZ", "UTC")
USE_TZ = True

STATIC_URL = "/static/"
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024 * 1024  # base64 screenshots and score clips
FILE_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 100,
}
