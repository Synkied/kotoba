from django.urls import path

from . import views

urlpatterns = [
    path("addons", views.addons),
    path("engine/status", views.engine_status),
    path("engine/load", views.engine_load),
    path("engine/score", views.engine_score),
    path("engine/prepare", views.engine_prepare),
    path("engine/tts", views.engine_tts),
    path("engine/tts/status", views.engine_tts_status),
    path("engine/tts/load", views.engine_tts_load),
    path("jobs", views.job_list),
    path("jobs/<int:job_id>", views.job),
    path("recordings", views.recordings),
    path("sources/<int:pk>/cleanup", views.source_cleanup),
    path("sources/<int:pk>/analyze", views.source_analyze),
    path("sources/<int:pk>/cuts", views.source_cuts),
    path("sources/<int:pk>/script", views.source_script),
    path("sources/<int:pk>/render", views.source_render),
    path("sources/<int:pk>/peaks", views.source_peaks),
    path("sources/<int:pk>/clean", views.source_clean),
]
