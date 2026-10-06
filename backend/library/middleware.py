from urllib.parse import urlsplit

from django.conf import settings
from django.http import JsonResponse

SAFE = {"GET", "HEAD", "OPTIONS"}


class SameOriginWrites:
    """Refuse writes sent by another website. There are no accounts, so this is what
    stops a page you visit from changing your library. Requests without an Origin
    header (screen-ocr pushing captures, curl) are let through, as screen_ocr does."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        if request.method not in SAFE and origin:
            host = urlsplit(origin).hostname or ""
            dev = settings.DEBUG and host in ("localhost", "127.0.0.1")
            if host != request.get_host().split(":")[0] and not dev:
                return JsonResponse({"error": "cross-site request refused"}, status=403)
        return self.get_response(request)
