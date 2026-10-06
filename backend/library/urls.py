from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter(trailing_slash=False)
router.register("sources", views.SourceViewSet, basename="source")
router.register("sentences", views.SentenceViewSet, basename="sentence")
router.register("decks", views.DeckViewSet, basename="deck")

urlpatterns = [
    path("captures", views.captures),               # screen-ocr --server pushes here
    path("collect/text", views.collect_text),
    path("collect/file", views.collect_file),
    path("sources/bulk", views.bulk),
    path("facets", views.facets),
    path("stats", views.stats),
    path("attempts", views.attempts),
    path("review", views.review),
    *router.urls,
]
