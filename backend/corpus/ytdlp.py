"""yt-dlp, kept in the data folder rather than the image: YouTube changes often and yt-dlp follows
within days, so kotoba fetches its release build once and updates it on its own (update()).
A yt-dlp on the PATH is used when there's none in the data folder.

YouTube now wants a JavaScript runtime for its players. deno, node or bun on the PATH is used;
failing those, kotoba fetches deno (Linux only) next to yt-dlp.

YouTube also refuses subtitle downloads ("too many requests") without a proof-of-origin token,
what a browser sends. The bgutil plugin (a Python dependency) asks a small token server for one:
compose.yaml runs it next to kotoba, at KOTOBA_POT_URL (127.0.0.1:4416 when unset)."""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from django.conf import settings

TOOLS = settings.DATA_DIR / "tools"
YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-{arch}-unknown-linux-gnu.zip"
TIMEOUT = 90
POT_URL = os.environ.get("KOTOBA_POT_URL", "").rstrip("/")


class YtError(Exception):
    """kind: members (members-only, private), gone (removed, unavailable), throttled (YouTube
    wants fewer requests for a while), or other."""

    def __init__(self, message: str, kind: str = "other"):
        super().__init__(message)
        self.kind = kind


# --- the tools ---------------------------------------------------------------------

def _zipapp() -> Path:
    return TOOLS / "yt-dlp"


def command() -> list | None:
    """How to run yt-dlp here, or None when there's none."""
    if _zipapp().exists():
        return [sys.executable, str(_zipapp())]
    found = shutil.which("yt-dlp")
    return [found] if found else None


def js_runtime() -> tuple[str, str] | None:
    """(name, path) of the JavaScript runtime yt-dlp will use."""
    for name in ("deno", "node", "bun"):
        found = shutil.which(name)
        if found:
            return name, found
    own = TOOLS / "deno"
    return ("deno", str(own)) if own.exists() else None


_version = {"at": 0.0, "value": None}


def version() -> str | None:
    if time.monotonic() - _version["at"] < 600 and _version["value"]:
        return _version["value"]
    cmd = command()
    if not cmd:
        return None
    try:
        out = subprocess.run([*cmd, "--version"], capture_output=True, text=True, timeout=30)
        _version.update(at=time.monotonic(), value=out.stdout.strip() or None)
    except (OSError, subprocess.TimeoutExpired):
        _version.update(at=time.monotonic(), value=None)
    return _version["value"]


def _download(url: str, dest: Path):
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.replace(dest)


def install() -> None:
    """Fetch yt-dlp's release build into the data folder, and deno when no runtime is around."""
    TOOLS.mkdir(parents=True, exist_ok=True)
    if not _zipapp().exists():
        _download(YTDLP_URL, _zipapp())
        _zipapp().chmod(0o755)
        _version["at"] = 0.0
    arch = _deno_arch()
    if js_runtime() is None and arch:
        archive = TOOLS / "deno.zip"
        _download(DENO_URL.format(arch=arch), archive)
        part = TOOLS / "deno.part"
        with zipfile.ZipFile(archive) as z, z.open("deno") as src, open(part, "wb") as f:
            shutil.copyfileobj(src, f)
        part.chmod(0o755)
        part.replace(TOOLS / "deno")
        archive.unlink()


def _deno_arch() -> str | None:
    """The deno build to fetch here, when kotoba fetches one (Linux only)."""
    if sys.platform != "linux":
        return None
    return {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine().lower())


def missing() -> bool:
    """Whether install() has something left to fetch: kotoba may have stopped halfway through."""
    return command() is None or (js_runtime() is None and _deno_arch() is not None)


def update() -> str:
    """Bring the data folder's yt-dlp up to date. Returns what it said."""
    if not _zipapp().exists():
        install()
        return f"Installed yt-dlp {version() or ''}".strip()
    out = subprocess.run([sys.executable, str(_zipapp()), "-U"], capture_output=True, text=True, timeout=180)
    _version["at"] = 0.0
    said = (out.stdout + out.stderr).strip().splitlines()
    return said[-1] if said else ""


# --- running it -------------------------------------------------------------------

_THROTTLED = re.compile(r"HTTP Error 429|Too Many Requests|confirm you.re not a bot|rate.limit", re.I)
_GONE = re.compile(r"video unavailable|has been removed|no longer available|does not exist|account .* terminated", re.I)
_MEMBERS = re.compile(r"members|private video|sign in|join this channel|confirm your age|age-restricted", re.I)


def _error(stderr: str) -> YtError:
    lines = [l for l in stderr.splitlines() if l.startswith("ERROR")] or stderr.strip().splitlines()[-1:] or ["yt-dlp failed"]
    message = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{11}:\s*)?", "", lines[-1]).strip()
    kind = ("throttled" if _THROTTLED.search(message) else "members" if _MEMBERS.search(message)
            else "gone" if _GONE.search(message) else "other")
    return YtError(message[:500], kind)


def run(args: list, timeout: int = TIMEOUT) -> str:
    cmd = command()
    if not cmd:
        raise YtError("yt-dlp isn't installed. Turn YouTube listening on in Add-ons.")
    js = js_runtime()
    extra = ["--js-runtimes", f"{js[0]}:{js[1]}"] if js else []
    if POT_URL:
        extra += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POT_URL}"]
    try:
        out = subprocess.run([*cmd, "--ignore-config", "--no-progress", *extra, *args],
                             capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise YtError("YouTube took too long to answer.")
    if out.returncode != 0:
        raise _error(out.stderr)
    return out.stdout


def _json(args: list, timeout: int = TIMEOUT) -> dict:
    try:
        return json.loads(run(["-J", *args], timeout))
    except ValueError:
        raise YtError("yt-dlp gave an answer kotoba couldn't read.")


# --- what's there ----------------------------------------------------------------------

_HANDLE = re.compile(r"^https?://(www\.|m\.)?youtube\.com/(@[^/?#]+|channel/[\w-]+|c/[^/?#]+|user/[^/?#]+)/?(\?.*)?$")


def normalize(url: str) -> tuple[str, str]:
    """(kind, url): a channel's address reads its uploads (not its shorts or lives); a playlist
    stays one. Raises ValueError for anything else."""
    url = url.strip()
    if url.startswith("@"):
        url = "https://www.youtube.com/" + url
    m = _HANDLE.match(url)
    if m:
        return "channel", f"https://www.youtube.com/{m[2]}/videos"
    if re.match(r"^https?://(www\.|m\.)?youtube\.com/(@[^/]+|channel/[\w-]+|c/[^/]+|user/[^/]+)/(videos|streams|podcasts)/?$", url):
        return "channel", url.rstrip("/").replace("://m.", "://www.")
    m = re.search(r"[?&]list=([\w-]+)", url)
    if m:
        return "playlist", f"https://www.youtube.com/playlist?list={m[1]}"
    if re.search(r"youtu\.be/|youtube\.com/(watch|shorts)", url):
        raise ValueError("That's one video. Add its channel (the @name on its page) or a playlist it's in.")
    raise ValueError("That isn't a YouTube channel or playlist address: try https://www.youtube.com/@name.")


def listing(url: str) -> tuple[str, list[dict]]:
    """(title, [{id, title, duration}]) of a channel's uploads or a playlist, newest first."""
    data = _json(["--flat-playlist", url], timeout=300)
    title = data.get("channel") or data.get("uploader") or data.get("title") or ""
    title = re.sub(r"\s+-\s+Videos$", "", title)
    entries = []
    for e in data.get("entries") or []:
        if e.get("_type") == "playlist":  # a channel without /videos lists its tabs
            continue
        if e.get("id") and len(e["id"]) == 11:
            entries.append({"id": e["id"], "title": e.get("title") or "", "duration": e.get("duration")})
    return title, entries


def search(query: str, n: int = 20) -> list[dict]:
    """The first n videos YouTube finds for query."""
    data = _json(["--flat-playlist", f"ytsearch{n}:{query}"], timeout=120)
    return [{"id": e["id"], "title": e.get("title") or "", "duration": e.get("duration")}
            for e in data.get("entries") or [] if e.get("id") and len(e["id"]) == 11]


def look(yt_id: str) -> dict:
    """A video's details, the addresses of its subtitles among them."""
    return _json(["--skip-download", f"https://www.youtube.com/watch?v={yt_id}"])


def japanese_track(meta: dict) -> str | None:
    """The language code of a video's human-made Japanese subtitles; None without them
    (YouTube's automatic captions don't count)."""
    tracks = meta.get("subtitles") or {}
    for lang in sorted(tracks, key=lambda l: (l != "ja", l)):
        if (lang == "ja" or lang.startswith("ja-")) and any(t.get("ext") == "json3" for t in tracks[lang]):
            return lang
    return None


def subtitles(meta: dict, lang: str) -> list[tuple[float, float, str]]:
    """The cues of one of the video's subtitle tracks, from the details look() gave. yt-dlp
    downloads them itself, passing for a browser (curl_cffi), as YouTube refuses plain requests."""
    with tempfile.TemporaryDirectory() as tmp:
        info = Path(tmp) / "info.json"
        info.write_text(json.dumps(meta), "utf-8")
        run(["--load-info-json", str(info), "--skip-download", "--write-subs", "--sub-langs", re.escape(lang),
             "--sub-format", "json3", "-o", str(Path(tmp) / "subs.%(ext)s")])
        found = list(Path(tmp).glob("subs.*.json3"))
        if not found:
            raise YtError("yt-dlp didn't save the subtitles.")
        try:
            return parse_json3(json.loads(found[0].read_text("utf-8")))
        except ValueError as e:
            raise YtError(f"Couldn't read the subtitles: {e}")


_NOISE = re.compile(r"^[\s\[\(（【［]*(音楽|拍手|笑|笑い|music|applause|laughter)[\]\)）】］\s]*$", re.I)


def parse_json3(data: dict) -> list[tuple[float, float, str]]:
    """A json3 track as [(start, end, text)] in seconds, its line breaks joined and lines with
    no Japanese in them left out ([音楽])."""
    out = []
    for e in data.get("events") or []:
        segs = e.get("segs")
        if not segs or "tStartMs" not in e:
            continue
        text = "".join(s.get("utf8", "") for s in segs)
        text = re.sub(r"\s*\n\s*", "", text).strip()
        if not text or _NOISE.match(text) or not re.search(r"[぀-ヿ一-鿿]", text):
            continue
        start = e["tStartMs"] / 1000
        end = start + (e.get("dDurationMs") or 0) / 1000
        if out and abs(out[-1][0] - start) < 0.01 and out[-1][2] == text:
            continue
        out.append((start, max(end, start + 0.3), text))
    # a cue stays up until the next one comes; it can't run past it
    for i in range(len(out) - 1):
        s, e, t = out[i]
        if e > out[i + 1][0]:
            out[i] = (s, max(s + 0.3, out[i + 1][0]), t)
    return out


# --- audio -----------------------------------------------------------------------------

def audio(yt_id: str, folder: Path) -> Path:
    """A video's audio track, as YouTube has it (Opus in WebM, usually; 3 MB for 12 minutes),
    saved as folder/<id>.weba (or .m4a). yt-dlp's own downloader, because YouTube refuses a
    plain request for most of its stream addresses."""
    incoming = folder / ".incoming"  # moved into folder once whole, so a stop halfway leaves nothing there
    incoming.mkdir(parents=True, exist_ok=True)
    for left in incoming.glob(f"{yt_id}.*"):  # cut short last time: yt-dlp would take it as done
        left.unlink()
    out = run(["-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio", "--no-playlist", "--no-part",
               "-o", str(incoming / f"{yt_id}.%(ext)s"), "--print", "after_move:filepath",
               f"https://www.youtube.com/watch?v={yt_id}"], timeout=900)
    got = Path(out.strip().splitlines()[-1]) if out.strip() else None
    if not got or not got.exists():
        raise YtError("yt-dlp didn't save the audio.")
    ext = ".weba" if got.suffix == ".webm" else got.suffix  # audio only: say so, so <audio> takes it everywhere
    return got.replace(folder / f"{yt_id}{ext}")


def available() -> bool:
    return command() is not None


_pot = {"at": 0.0, "value": None}


def pot() -> str | None:
    """The version of the token server answering, or None. Asked at most once a minute."""
    if time.time() - _pot["at"] > 60:
        try:
            with urllib.request.urlopen(f"{POT_URL or 'http://127.0.0.1:4416'}/ping", timeout=2) as r:
                _pot["value"] = str(json.loads(r.read()).get("version") or "?")
        except (OSError, ValueError):
            _pot["value"] = None
        _pot["at"] = time.time()
    return _pot["value"]


def environ_note() -> str | None:
    """What's missing for YouTube to keep working, if anything."""
    if js_runtime() is None:
        return "No JavaScript runtime (deno or node): YouTube may refuse to play some videos."
    if pot() is None:
        return (f"No token server answers at {POT_URL or 'http://127.0.0.1:4416'}: YouTube soon refuses subtitle "
                "downloads without one (see the README).")
    return None
