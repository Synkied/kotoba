import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import translate
from .models import Sentence, Source


class FakeLLM(BaseHTTPRequestHandler):
    """An OpenAI-compatible server, the way Ollama and llama-server answer."""
    requests = []
    reply = "<think>polite question</think>\n\"Which one comes first?\""
    strict = False  # answer 400 to fields it doesn't know, the way some servers do

    def do_GET(self):
        self._json({"data": [{"id": "qwen2.5:7b"}]} if self.path == "/v1/models" else {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeLLM.requests.append({"path": self.path, "body": body, "auth": self.headers.get("Authorization")})
        if FakeLLM.strict and "reasoning_effort" in body:
            raw = b'{"error": "unknown field reasoning_effort"}'
            self.send_response(400)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        self._json({"choices": [{"message": {"content": FakeLLM.reply}}]})

    def _json(self, data):
        raw = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


class TranslateTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeLLM)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.llm = override_settings(LLM={"url": f"http://127.0.0.1:{cls.server.server_port}/v1", "model": "", "key": "k"})
        cls.llm.enable()

    @classmethod
    def tearDownClass(cls):
        cls.llm.disable()
        cls.server.shutdown()
        super().tearDownClass()

    def setUp(self):
        FakeLLM.requests = []
        FakeLLM.strict = False
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        settings_file = patch.object(translate, "_SETTINGS", Path(tmp.name) / "settings.json")  # not the real data dir
        settings_file.start()
        self.addCleanup(settings_file.stop)
        src = Source.objects.create(kind="text", text="", status="kept")
        self.lines = [Sentence.objects.create(source=src, position=i, text=t)
                      for i, t in enumerate(["映画と本、どちらが好きですか。", "どちらが先ですか?", "映画です。"])]

    def test_translates_with_neighbours_and_cleans_the_reply(self):
        r = self.client.post(f"/api/sentences/{self.lines[1].id}/translate", {"to": "fr"}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["translations"], {"fr": "Which one comes first?"})
        sent = FakeLLM.requests[0]
        self.assertEqual(sent["body"]["model"], "qwen2.5:7b")  # the first one the server lists
        self.assertEqual(sent["auth"], "Bearer k")
        prompt = sent["body"]["messages"][1]["content"]
        self.assertIn("映画と本、どちらが好きですか。", prompt)
        self.assertIn("映画です。", prompt)
        self.assertIn("French", prompt)

    def test_asks_a_local_model_not_to_think_and_copes_with_a_server_that_refuses(self):
        self.client.post(f"/api/sentences/{self.lines[0].id}/translate", {}, content_type="application/json")
        body = FakeLLM.requests[0]["body"]
        self.assertEqual((body["reasoning_effort"], body["chat_template_kwargs"]), ("none", {"enable_thinking": False}))
        FakeLLM.strict, FakeLLM.requests = True, []
        r = self.client.post(f"/api/sentences/{self.lines[1].id}/translate", {}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(FakeLLM.requests), 2)
        self.assertNotIn("reasoning_effort", FakeLLM.requests[1]["body"])

    def test_keeps_an_existing_translation_unless_forced(self):
        s = self.lines[0]
        s.translations = {"en": "Mine."}
        s.save()
        self.client.post(f"/api/sentences/{s.id}/translate", {"to": "en"}, content_type="application/json")
        self.assertEqual(FakeLLM.requests, [])
        r = self.client.post(f"/api/sentences/{s.id}/translate", {"to": "en", "force": True}, content_type="application/json")
        self.assertEqual(r.json()["translations"]["en"], "Which one comes first?")

    def test_editing_the_text_drops_old_translations(self):
        s = self.lines[2]
        self.client.patch(f"/api/sentences/{s.id}", {"translations": {"en": " Film. "}}, content_type="application/json")
        s.refresh_from_db()
        self.assertEqual(s.translations, {"en": "Film."})
        self.client.patch(f"/api/sentences/{s.id}", {"text": "本です。"}, content_type="application/json")
        s.refresh_from_db()
        self.assertEqual(s.translations, {})

    def test_language_setting_and_status(self):
        r = self.client.patch("/api/translation", {"to": "de"}, content_type="application/json")
        self.assertEqual(r.json()["to"], "de")
        self.assertTrue(r.json()["ready"])
        self.assertFalse(r.json()["cloud"])
        self.assertEqual(r.json()["sentences"], 3)
        self.assertEqual(self.client.patch("/api/translation", {"to": "xx"}, content_type="application/json").status_code, 400)

    def test_quick_language_says_whether_the_translator_is_in_the_cloud(self):
        quick = self.client.get("/api/translation?quick=1").json()
        self.assertFalse(quick["cloud"])  # the test server is on 127.0.0.1
        t = self.client.post("/api/translation/translators", {"kind": "openai", "url": "https://api.example.com/v1", "model": "m", "key": "sk-secret-1234567890"},
                             content_type="application/json").json()
        self.client.patch("/api/translation", {"active": t["id"]}, content_type="application/json")
        quick = self.client.get("/api/translation?quick=1").json()
        self.assertEqual((quick["translator"], quick["cloud"]), (t["name"], True))

    def test_unreachable_server_is_a_clear_error(self):
        with override_settings(LLM={"url": "http://127.0.0.1:9/v1", "model": "m", "key": ""}):
            r = self.client.post(f"/api/sentences/{self.lines[0].id}/translate", {}, content_type="application/json")
        self.assertEqual(r.status_code, 503)
        self.assertIn("No translation server", r.json()["error"])

    def test_saved_translators_one_active_keys_never_sent_back(self):
        url = f"http://127.0.0.1:{self.server.server_port}/v1"
        r = self.client.post("/api/translation/translators", {"kind": "openai", "url": url, "model": "m1", "key": "sk-secret-1234567890"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 201)
        t = r.json()
        self.assertNotIn("key", t)
        self.assertEqual((t["key_set"], t["key_hint"], t["name"]), (True, "…7890", "OpenAI-compatible API"))
        listing = self.client.get("/api/translation").json()
        self.assertEqual(listing["active"], "env")  # saved, not used until chosen
        self.assertEqual([x["id"] for x in listing["translators"]], ["env", t["id"]])
        self.assertNotIn("sk-secret", json.dumps(listing))

        self.assertEqual(self.client.patch("/api/translation", {"active": t["id"]}, content_type="application/json").json()["active"], t["id"])
        self.client.post(f"/api/sentences/{self.lines[0].id}/translate", {"to": "en"}, content_type="application/json")
        self.assertEqual(FakeLLM.requests[-1]["body"]["model"], "m1")
        self.assertEqual(FakeLLM.requests[-1]["auth"], "Bearer sk-secret-1234567890")

        # renaming keeps the key; a new address without a new key drops it
        self.client.patch(f"/api/translation/translators/{t['id']}", {"kind": "openai", "name": "Mine", "url": url, "model": "m1"}, content_type="application/json")
        self.assertEqual(translate._active()["key"], "sk-secret-1234567890")
        moved = self.client.patch(f"/api/translation/translators/{t['id']}", {"kind": "openai", "url": "http://127.0.0.1:9/v1", "model": "m1"},
                                  content_type="application/json").json()
        self.assertFalse(moved["key_set"])

        self.assertEqual(self.client.delete(f"/api/translation/translators/{t['id']}").status_code, 204)
        self.assertEqual(self.client.get("/api/translation").json()["active"], "env")

    def test_forms_are_checked_and_tested_unsaved(self):
        bad = self.client.post("/api/translation/translators", {"kind": "openai", "url": "nope"}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.client.post("/api/translation/translators", {"kind": "openai", "url": "http://x/v1"},
                                          content_type="application/json").status_code, 400)  # no model
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
            self.assertEqual(self.client.post("/api/translation/translators", {"kind": "anthropic"}, content_type="application/json").status_code, 400)
        url = f"http://127.0.0.1:{self.server.server_port}/v1"
        r = self.client.post("/api/translation/translators/test", {"kind": "ollama", "url": url}, content_type="application/json").json()
        self.assertTrue(r["ready"])
        self.assertEqual(r["models"], ["qwen2.5:7b"])
        self.assertFalse(r["cloud"])
        self.assertEqual(len(self.client.get("/api/translation").json()["translators"]), 1)  # testing saved nothing
