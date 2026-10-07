import io
import json
import tempfile
import hashlib
from unittest.mock import patch
from pathlib import Path

from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from pypdf import PdfWriter

from .models import ListeningLesson, ListeningExercise, ListeningAttempt


class ListeningTests(TestCase):
    def setUp(self):
        self.lesson = ListeningLesson.objects.create(slug="lesson-18", title="Lesson 18", pdf="listening/worksheet.pdf")
        self.exercise = ListeningExercise.objects.create(
            lesson=self.lesson, position=1, title="Dogs", audio="listening/track.mp3",
            questions=[{"id": "1", "prompt": "ジャック", "choices": [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]}],
        )
        self.url = f"/api/listening/exercises/{self.exercise.id}/attempts"

    def submit(self, data):
        return self.client.post(self.url, data, content_type="application/json")

    def test_self_review_is_saved_and_returns_without_invented_score(self):
        response = self.submit({"responses": {"1": "b"}})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["score"])
        self.assertIsNone(response.json()["feedback"][0]["correct"])
        exercise = self.client.get("/api/listening").json()[0]["exercises"][0]
        self.assertEqual(exercise["latest_attempt"]["responses"], {"1": "b"})
        self.assertEqual(exercise["attempt_count"], 1)
        self.submit({"responses": {"1": "a"}})
        self.assertEqual(ListeningAttempt.objects.count(), 2)
        self.assertEqual(self.client.get("/api/listening").json()[0]["exercises"][0]["latest_attempt"]["responses"], {"1": "a"})

    def test_incomplete_or_invalid_submissions_do_not_create_attempts(self):
        for body in [[], {}, {"responses": []}, {"responses": {}}, {"responses": {"1": "z"}},
                     {"responses": {"1": " "}}, {"responses": {"1": 3}},
                     {"responses": {"1": "a", "extra": "a"}}, {"responses": {"1": "a" * 501}}]:
            self.assertEqual(self.submit(body).status_code, 400, body)
        self.assertEqual(ListeningAttempt.objects.count(), 0)

    def test_verified_keys_are_hidden_until_submission_and_normalize_free_text(self):
        self.exercise.questions = [{"id": "1", "prompt": "趣味", "answer": ["絵をかくこと", "絵を描くこと"], "explanation": "Verified correction"}]
        self.exercise.save()
        question = self.client.get("/api/listening").json()[0]["exercises"][0]["questions"][0]
        self.assertNotIn("answer", question)
        self.assertNotIn("explanation", question)
        response = self.submit({"responses": {"1": "　絵を描くこと　"}})
        self.assertEqual(response.json()["score"], 1)
        self.assertEqual(response.json()["feedback"][0]["answer"], "絵をかくこと")
        self.assertEqual(self.submit({"responses": {"1": "wrong"}}).json()["score"], 0)

    def test_reimport_preserves_attempts_and_uses_stable_assets(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            pdf = PdfWriter()
            pdf.add_blank_page(width=100, height=100)
            with (folder / "lesson.pdf").open("wb") as output:
                pdf.write(output)
            (folder / "audio.mp3").write_bytes(b"test audio")
            manifest = folder / "manifest.json"
            manifest.write_text(json.dumps({"slug": self.lesson.slug, "title": "Updated lesson", "pdf": "lesson.pdf", "exercises": [{"position": 1, "title": "Updated exercise", "instructions": "Listen", "audio": "audio.mp3", "questions": self.exercise.questions}]}))
            self.submit({"responses": {"1": "a"}})
            with override_settings(MEDIA_ROOT=folder / "media"):
                for _ in range(2):
                    call_command("import_listening", str(folder), manifest=manifest, stdout=io.StringIO())
                self.assertEqual(ListeningLesson.objects.count(), 1)
                self.assertEqual(ListeningExercise.objects.count(), 1)
                self.assertEqual(ListeningAttempt.objects.count(), 1)
                self.assertEqual(len(list((folder / "media").rglob("*.mp3"))), 1)
                self.assertEqual(self.client.get("/api/listening").json()[0]["title"], "Updated lesson")


class ListeningPackageTests(TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.settings_override = override_settings(MEDIA_ROOT=self.folder.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        stream = io.BytesIO()
        writer.write(stream)
        self.pdf = stream.getvalue()

    def upload(self, pdf=None, audios=None, title="My lesson"):
        return self.client.post("/api/listening/packages", {"title": title, "files": [SimpleUploadedFile("worksheet.pdf", self.pdf if pdf is None else pdf, "application/pdf"), *[SimpleUploadedFile(name, data, "audio/mpeg") for name, data in (audios or [("track.mp3", b"audio")])]]})

    def test_combined_upload_creates_one_package_and_quiz_per_recording(self):
        response = self.upload(audios=[("second.mp3", b"two"), ("first.mp3", b"one")])
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["title"], "My lesson")
        self.assertEqual(data["page_count"], 1)
        self.assertEqual([e["title"] for e in data["exercises"]], ["second", "first"])
        self.assertEqual(data["exercises"][0]["questions"], [])
        self.assertFalse(data["exercises"][0]["has_answer_key"])
        lesson = ListeningLesson.objects.get()
        self.assertTrue(lesson.pdf.storage.exists(lesson.pdf.name))
        self.assertEqual(lesson.exercises.first().audio.read(), b"two")
        self.assertEqual(self.upload().status_code, 201)
        self.assertEqual(ListeningLesson.objects.count(), 2)

    def test_invalid_or_incomplete_files_do_not_leave_a_package(self):
        for files in [[], [SimpleUploadedFile("worksheet.pdf", self.pdf)], [SimpleUploadedFile("a.mp3", b"a")],
                      [SimpleUploadedFile("a.pdf", self.pdf), SimpleUploadedFile("b.pdf", self.pdf), SimpleUploadedFile("a.mp3", b"a")],
                      [SimpleUploadedFile("a.pdf", self.pdf), SimpleUploadedFile("a.jpg", b"a")]]:
            self.assertEqual(self.client.post("/api/listening/packages", {"files": files}).status_code, 400)
        self.assertEqual(self.upload(pdf=b"not a PDF").status_code, 400)
        self.assertEqual(self.upload(title="x" * 201).status_code, 400)
        self.assertEqual(ListeningLesson.objects.count(), 0)
        self.assertEqual(list(Path(self.folder.name).rglob("*")), [])

    def test_known_files_are_recognized_by_content_even_when_renamed_and_reordered(self):
        manifest = {"title": "Known lesson", "description": "Reviewed", "pdf_sha256": hashlib.sha256(self.pdf).hexdigest(), "exercises": [
            {"title": "First quiz", "instructions": "Listen", "questions": [{"id": "1", "prompt": "First"}], "audio_sha256": hashlib.sha256(b"first").hexdigest()},
            {"title": "Second quiz", "instructions": "Listen", "questions": [{"id": "1", "prompt": "Second"}], "audio_sha256": hashlib.sha256(b"second").hexdigest()},
        ]}
        with patch("library.listening_packages.Path.read_text", return_value=json.dumps(manifest)):
            response = self.upload(audios=[("renamed2.mp3", b"second"), ("renamed1.mp3", b"first")], title="")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["title"], "Known lesson")
        self.assertEqual([e["questions"][0]["prompt"] for e in response.json()["exercises"]], ["First", "Second"])
        self.assertEqual(ListeningExercise.objects.order_by("position").first().audio.read(), b"first")

    def test_question_editing_and_versions_preserve_old_attempts(self):
        exercise = self.upload().json()["exercises"][0]
        edit_url = f"/api/listening/exercises/{exercise['id']}"
        submit_url = edit_url + "/attempts"
        self.assertEqual(self.client.post(submit_url, {"responses": {}}, content_type="application/json").status_code, 400)
        payload = {"revision": 1, "questions": [{"id": "1", "prompt": "What did you hear?"}], "worksheet_page": 1}
        updated = self.client.patch(edit_url, payload, content_type="application/json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["revision"], 2)
        self.assertEqual(self.client.post(submit_url, {"responses": {"1": "hello"}, "revision": 1}, content_type="application/json").status_code, 409)
        self.assertEqual(self.client.post(submit_url, {"responses": {"1": "hello"}, "revision": 2}, content_type="application/json").status_code, 201)
        payload["revision"] = 2
        payload["questions"][0]["prompt"] = "Which person?"
        changed = self.client.patch(edit_url, payload, content_type="application/json")
        self.assertEqual(changed.json()["revision"], 3)
        self.assertIsNone(changed.json()["latest_attempt"])
        self.assertEqual(ListeningAttempt.objects.get().responses, {"1": "hello"})
        self.assertEqual(self.client.patch(edit_url, payload, content_type="application/json").status_code, 409)

    def test_invalid_questions_are_rejected_without_mutation(self):
        exercise = self.upload().json()["exercises"][0]
        url = f"/api/listening/exercises/{exercise['id']}"
        for questions in [[], [{"id": "1", "prompt": ""}], [{"id": "1", "prompt": "A"}, {"id": "1", "prompt": "B"}], [{"id": "1", "prompt": "A", "choices": [{"value": "a", "label": "A"}]}]]:
            self.assertEqual(self.client.patch(url, {"revision": 1, "questions": questions}, content_type="application/json").status_code, 400)
        self.assertEqual(ListeningExercise.objects.get().questions, [])

    def test_password_protected_pdf_is_rejected_without_partial_import(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.encrypt("secret")
        data = io.BytesIO()
        writer.write(data)
        response = self.upload(pdf=data.getvalue())
        self.assertEqual(response.status_code, 400)
        self.assertIn("password protected", response.json()["error"])
        self.assertEqual(ListeningLesson.objects.count(), 0)

    def test_storage_failure_rolls_back_package_and_removes_saved_files(self):
        storage = ListeningLesson._meta.get_field("pdf").storage
        original_save = storage.save
        calls = 0

        def fail_second_save(name, content, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("Disk full")
            return original_save(name, content, *args, **kwargs)

        with patch.object(storage, "save", side_effect=fail_second_save):
            with self.assertRaises(OSError):
                self.upload()
        self.assertEqual(ListeningLesson.objects.count(), 0)
        self.assertFalse(any(path.is_file() for path in Path(self.folder.name).rglob("*")))
