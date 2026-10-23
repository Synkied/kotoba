from django.urls import path

from . import views

urlpatterns = [
    path("youtube", views.status),
    path("youtube/update", views.update),
    path("youtube/channels", views.channels),
    path("youtube/channels/<int:pk>", views.channel),
    path("youtube/heard", views.heard_lines),
    path("youtube/counts", views.counts),
    path("youtube/find", views.find),
    path("youtube/search", views.search),
    path("youtube/lines/<int:pk>/context", views.line_context),
    path("youtube/videos/<int:pk>/audio", views.video_audio),
    path("youtube/lines/<int:pk>/keep", views.line_keep),
    path("dict/<path:key>", views.term),
]
