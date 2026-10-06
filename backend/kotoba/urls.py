from django.conf import settings
import mimetypes

from django.http import HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve


def spa(request, rest=""):
    """The built React app (frontend/dist). Unknown paths get index.html so client-side
    routes like /practice/3 survive a reload."""
    dist = settings.FRONTEND_DIST
    target = (dist / rest).resolve()
    if rest and target.is_file() and dist.resolve() in target.parents:
        # read whole: the built assets are small, and hashed names make them cacheable forever
        resp = HttpResponse(target.read_bytes(), content_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        if rest.startswith("assets/"):
            resp["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp
    index = dist / "index.html"
    if not index.exists():
        return HttpResponse("kotoba: the frontend isn't built. Run `npm run build` in frontend/, "
                            "or use `npm run dev` and open http://localhost:5173.", content_type="text/plain")
    return HttpResponse(index.read_bytes(), content_type="text/html; charset=utf-8")


urlpatterns = [
    path("api/", include("speech.urls")),
    path("api/", include("library.urls")),
    re_path(r"^files/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    re_path(r"^(?P<rest>.*)$", spa),
]
