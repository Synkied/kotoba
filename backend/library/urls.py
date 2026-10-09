from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views, lessons

router = SimpleRouter(trailing_slash=False)
router.register("sources", views.SourceViewSet, basename="source")
router.register("sentences", views.SentenceViewSet, basename="sentence")
router.register("decks", views.DeckViewSet, basename="deck")
router.register("lessons", lessons.LessonViewSet, basename="lesson")
router.register("materials", lessons.MaterialViewSet, basename="material")
router.register("lesson-folders", lessons.LessonFolderViewSet, basename="lesson-folder")

urlpatterns = [
    path("lessons/arrange", lessons.arrange_lessons),
    path("lessons/<int:pk>/files/<int:fid>", lessons.lesson_file),
    path("captures", views.captures),               # screen-ocr --server pushes here
    path("collect/text", views.collect_text),
    path("collect/file", views.collect_file),
    path("sources/bulk", views.bulk),
    path("facets", views.facets),
    path("stats", views.stats),
    path("lookup", views.lookup),
    path("attempts", views.attempts),
    path("review", views.review),
    path("translation", views.translation),
    path("translation/translators", views.translators),
    path("translation/translators/test", views.translator_test),
    path("translation/translators/<str:tid>", views.translator),
    *router.urls,
]
