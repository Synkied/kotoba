"""kotoba settings. It runs on your own machine, reached over Tailscale, or on a server shared by
several learners: everyone signs in, and sees only their own library. The Origin check in
library.middleware keeps other websites from writing to it with your session."""
import os
import secrets
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

DEBUG = os.environ.get("KOTOBA_DEBUG", "1") == "1"
# Extra host names (e.g. pi.tail1234.ts.net) as a comma-separated list
ALLOWED_HOSTS = ["127.0.0.1", "localhost", *filter(None, os.environ.get("KOTOBA_HOSTS", "").split(","))]

# Where kotoba keeps its database and files
DATA_DIR = Path(os.environ.get("KOTOBA_DATA") or
                Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "kotoba")
DATA_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_ROOT = DATA_DIR / "files"
MEDIA_URL = "/files/"


def _secret_key() -> str:
    """KOTOBA_SECRET_KEY, or one made on the first run and kept in the data folder."""
    if os.environ.get("KOTOBA_SECRET_KEY"):
        return os.environ["KOTOBA_SECRET_KEY"]
    path = DATA_DIR / "secret_key"
    try:
        return path.read_text().strip()
    except FileNotFoundError:
        key = secrets.token_urlsafe(50)
        path.write_text(key)
        path.chmod(0o600)
        return key


SECRET_KEY = _secret_key()

# Accounts. KOTOBA_SIGNUP=1 lets anyone who reaches kotoba make one; otherwise they're made with
# `python manage.py adduser`. KOTOBA_HTTPS=1 behind an HTTPS proxy keeps the session cookie to HTTPS.
SIGNUP = os.environ.get("KOTOBA_SIGNUP", "0") == "1"
SESSION_COOKIE_AGE = 180 * 86400  # signed in on a phone for months, not days
SESSION_COOKIE_SAMESITE = "Lax"
if os.environ.get("KOTOBA_HTTPS", "0") == "1":
    SESSION_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

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
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "library",
    "speech",
    "corpus",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "library.middleware.SameOriginWrites",
    "django.middleware.common.CommonMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
X_FRAME_OPTIONS = "SAMEORIGIN"  # a lesson shows its PDF in a frame

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
    # the browser signs in with a session; screen-ocr and scripts send "Authorization: Token <key>"
    # (the token comes first so a request without either is answered 401, not 403)
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication",
                                       "library.auth.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"signin": "10/min"},
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 100,
}
