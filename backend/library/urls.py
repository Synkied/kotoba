from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views, lessons, notes

router = SimpleRouter(trailing_slash=False)
router.register("sources", views.SourceViewSet, basename="source")
router.register("sentences", views.SentenceViewSet, basename="sentence")
router.register("decks", views.DeckViewSet, basename="deck")
router.register("lessons", lessons.LessonViewSet, basename="lesson")
router.register("materials", lessons.MaterialViewSet, basename="material")
router.register("lesson-folders", lessons.LessonFolderViewSet, basename="lesson-folder")
router.register("notes", notes.NoteViewSet, basename="note")

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
    path("furigana", views.furigana),
    path("dictionary", views.dictionary_fetch),
    path("explain", views.explain),
    path("attempts", views.attempts),
    path("attempts/<int:pk>/audio", views.attempt_audio),
    path("review", views.review),
    path("search", views.search),
    path("words", views.word_list),
    path("words/next", views.word_next),
    path("words/<int:pk>", views.word_detail),
    path("sentences/<int:pk>/words", views.sentence_words),
    path("sources/<int:pk>/words", views.source_words),
    path("translation", views.translation),
    path("translation/translators", views.translators),
    path("translation/translators/test", views.translator_test),
    path("translation/translators/<str:tid>", views.translator),
    *router.urls,
]
