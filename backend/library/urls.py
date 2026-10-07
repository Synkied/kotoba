from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views, listening

router = SimpleRouter(trailing_slash=False)
router.register("sources", views.SourceViewSet, basename="source")
router.register("sentences", views.SentenceViewSet, basename="sentence")
router.register("decks", views.DeckViewSet, basename="deck")

urlpatterns = [
    path("listening", listening.lessons),
    path("listening/packages", listening.upload),
    path("listening/exercises/<int:exercise_id>", listening.edit_exercise),
    path("listening/exercises/<int:exercise_id>/attempts", listening.submit),
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
