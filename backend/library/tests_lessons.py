import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from unittest import mock

from django.test import TestCase, override_settings

from .models import Lesson, Source


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class LessonTests(TestCase):
    def create(self, **data):
        return self.client.post("/api/lessons", data)

    def test_create_with_files_and_serve_them(self):
        pdf = SimpleUploadedFile("Lesson 19.pdf", b"%PDF-1.4 worksheet", content_type="application/pdf")
        track = SimpleUploadedFile("track 22.mp3", b"ID3audio", content_type="audio/mpeg")
        response = self.create(files=[pdf, track])
        self.assertEqual(response.status_code, 201, response.content)
        lesson = response.json()
        self.assertEqual(lesson["title"], "Lesson 19")
        self.assertEqual([(f["name"], f["kind"]) for f in lesson["files"]], [("Lesson 19.pdf", "pdf"), ("track 22.mp3", "audio")])
        served = self.client.get(lesson["files"][1]["url"], HTTP_RANGE="bytes=0-2")
        self.assertEqual(served.status_code, 206)
        self.assertEqual(b"".join(served.streaming_content), b"ID3")

    def test_refuses_files_a_browser_would_run(self):
        page = SimpleUploadedFile("page.html", b"<script>", content_type="text/html")
        self.assertEqual(self.create(title="x", files=[page]).status_code, 400)
        self.assertFalse(Lesson.objects.exists())

    def test_done_lessons_leave_the_current_list_unless_pinned(self):
        study = Lesson.objects.create(title="Lesson 20")
        done = Lesson.objects.create(title="Lesson 18")
        reference = Lesson.objects.create(title="Verb forms")
        for lesson, data in ((done, {"done": True}), (reference, {"done": True, "pinned": True})):
            self.assertEqual(self.client.patch(f"/api/lessons/{lesson.id}", data, content_type="application/json").status_code, 200)
        current = {l["title"] for l in self.client.get("/api/lessons").json()}
        archive = [l["title"] for l in self.client.get("/api/lessons?state=done").json()]
        self.assertEqual(current, {"Lesson 20", "Verb forms"})
        self.assertEqual(archive, ["Verb forms", "Lesson 18"])
        self.assertEqual(self.client.get("/api/stats").json()["lessons"], 1)
        # back to study: out of the archive
        self.client.patch(f"/api/lessons/{done.id}", {"done": False}, content_type="application/json")
        self.assertEqual([l["title"] for l in self.client.get("/api/lessons?state=done&q=verb").json()], ["Verb forms"])
        self.assertIsNone(Lesson.objects.get(pk=done.id).done_at)
        self.assertEqual(study.done_at, None)

    def test_link_sources(self):
        source = Source.objects.create(kind="text", text="こんにちは", status="kept", title="Dialogue")
        lesson = Lesson.objects.create(title="Lesson 19")
        response = self.client.patch(f"/api/lessons/{lesson.id}", {"sources": [source.id]}, content_type="application/json")
        self.assertEqual(response.json()["sources"], [{"id": source.id, "title": "Dialogue", "kind": "text", "status": "kept", "sentences": 0, "job": "", "media": None}])
        # and the source leads back to its lesson
        self.assertEqual(self.client.get(f"/api/sources/{source.id}").json()["lessons"], [{"id": lesson.id, "title": "Lesson 19", "done": False}])

    @mock.patch("speech.jobs.kick")
    def test_transcribe_a_recording_into_a_linked_source(self, kick):
        track = SimpleUploadedFile("1. Listen.mp3", b"ID3audio", content_type="audio/mpeg")
        lesson = self.create(title="Lesson 18", files=[track]).json()
        url = f"/api/lessons/{lesson['id']}/files/{lesson['files'][0]['id']}/transcribe"
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(url)
        self.assertEqual(response.status_code, 200, response.content)
        f = response.json()["files"][0]
        source = Source.objects.get(pk=f["source"])
        self.assertEqual((source.title, source.status, source.job, f["job"]), ("Lesson 18 · 1. Listen", "kept", "waiting", "waiting"))
        self.assertEqual(source.media.read(), b"ID3audio")
        self.assertEqual([s["id"] for s in response.json()["sources"]], [source.id])
        kick.assert_called_once()
        # asking again doesn't make a second copy; a failed one goes back in the queue
        Source.objects.filter(pk=source.id).update(job="failed", job_error="boom")
        self.client.post(url)
        self.assertEqual(Source.objects.count(), 1)
        self.assertEqual(Source.objects.get(pk=source.id).job, "waiting")
