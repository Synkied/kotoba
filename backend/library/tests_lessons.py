import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from unittest import mock

from django.test import TestCase, override_settings

from .models import Lesson, LessonFolder, Material, Source


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

    def test_folders_nest_and_keep_your_order(self):
        post = lambda url, data: self.client.post(url, data, content_type="application/json")
        minna = post("/api/lesson-folders", {"name": "  Minna   no Nihongo "}).json()
        self.assertEqual(minna["name"], "Minna no Nihongo")
        book = post("/api/lesson-folders", {"name": "Book 1", "parent": minna["id"]}).json()
        a = self.create(title="Lesson 1", folder=book["id"]).json()
        b = self.create(title="Lesson 2", folder=book["id"]).json()
        self.assertEqual((a["folder"], a["position"], b["position"]), (book["id"], 1, 2))
        # your order, not the order they came in
        self.assertEqual(post("/api/lessons/arrange", {"folder": book["id"], "lessons": [b["id"], a["id"]]}).status_code, 204)
        self.assertEqual([l["title"] for l in self.client.get("/api/lessons").json()], ["Lesson 2", "Lesson 1"])
        # a folder can't go inside itself, directly or further down
        self.assertEqual(post("/api/lessons/arrange", {"folder": book["id"], "folders": [minna["id"]]}).status_code, 400)
        r = self.client.patch(f"/api/lesson-folders/{minna['id']}", {"parent": book["id"]}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        # the archive finds lessons by their folder's name
        Lesson.objects.filter(pk=a["id"]).update(done_at="2026-10-01T00:00Z")
        self.assertEqual([l["title"] for l in self.client.get("/api/lessons?state=done&q=book").json()], ["Lesson 1"])
        # deleting a folder keeps what it held, one level up
        self.assertEqual(self.client.delete(f"/api/lesson-folders/{book['id']}").status_code, 204)
        self.assertEqual(set(Lesson.objects.values_list("folder", flat=True)), {minna["id"]})

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

    @mock.patch("speech.jobs.kick")
    def test_files_live_in_folders_without_a_lesson(self, kick):
        book = LessonFolder.objects.create(name="Book 1")
        pdf = SimpleUploadedFile("Lesson 19.pdf", b"%PDF-1.4", content_type="application/pdf")
        track = SimpleUploadedFile("track 22.mp3", b"ID3audio", content_type="audio/mpeg")
        r = self.client.post("/api/materials", {"files": [pdf, track], "folder": book.id})
        self.assertEqual(r.status_code, 201, r.content)
        made = r.json()
        self.assertEqual([(m["name"], m["kind"], m["folder"], m["position"]) for m in made],
                         [("Lesson 19.pdf", "pdf", book.id, 1), ("track 22.mp3", "audio", book.id, 2)])
        self.assertFalse(Lesson.objects.exists())
        served = self.client.get(made[1]["url"], HTTP_RANGE="bytes=0-2")
        self.assertEqual(b"".join(served.streaming_content), b"ID3")
        # transcribing is asked for, and only recordings are
        self.assertEqual(Source.objects.count(), 0)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post("/api/materials/transcribe", {"ids": [m["id"] for m in made]}, content_type="application/json")
        self.assertEqual([(m["name"], m["job"]) for m in r.json()], [("track 22.mp3", "waiting")])
        self.assertEqual(Source.objects.get().title, "track 22")
        kick.assert_called_once()
        # deleting the folder keeps its files, one level up
        self.client.delete(f"/api/lesson-folders/{book.id}")
        self.assertEqual(list(Material.objects.values_list("folder", flat=True)), [None, None])
        # pages a browser would run aren't kept
        page = SimpleUploadedFile("page.html", b"<script>", content_type="text/html")
        self.assertEqual(self.client.post("/api/materials", {"files": [page]}).status_code, 400)

    def test_a_lesson_made_from_folder_files_links_them(self):
        book = LessonFolder.objects.create(name="Book 1")
        pdf = SimpleUploadedFile("Lesson 19.pdf", b"%PDF-1.4", content_type="application/pdf")
        track = SimpleUploadedFile("track 22.mp3", b"ID3audio", content_type="audio/mpeg")
        made = self.client.post("/api/materials", {"files": [pdf, track], "folder": book.id}).json()
        r = self.create(folder=book.id, materials=[made[1]["id"], made[0]["id"]])
        self.assertEqual(r.status_code, 201, r.content)
        lesson = r.json()
        self.assertEqual((lesson["title"], lesson["folder"]), ("track 22", book.id))
        self.assertEqual([(f["name"], f["material"]) for f in lesson["files"]], [("track 22.mp3", made[1]["id"]), ("Lesson 19.pdf", made[0]["id"])])
        self.assertEqual(b"".join(self.client.get(lesson["files"][0]["url"]).streaming_content), b"ID3audio")
        self.assertEqual(self.client.get("/api/materials").json()[0]["lessons"], [{"id": lesson["id"], "title": "track 22"}])
        # taking a file out of the lesson, or deleting the lesson, leaves it in the folder
        self.client.delete(lesson["files"][1]["url"])
        self.client.delete(f"/api/lessons/{lesson['id']}")
        self.assertEqual(Material.objects.count(), 2)
        self.assertEqual(self.client.get(made[0]["url"]).status_code, 200)
