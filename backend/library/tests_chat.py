import threading
from unittest.mock import patch
from http.server import HTTPServer

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from . import translate
from .models import Conversation, Source
from .testing import SignedIn
from .tests_translate import FakeLLM


class ChatTests(SignedIn):
    """The fake OpenAI-compatible server from the translation tests is the LLM from the environment."""
    staff = True

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
        super().setUp()
        FakeLLM.requests = []

    def post(self, data):
        return self.client.post("/api/chat", data, content_type="application/json")

    def test_lists_the_llms_without_their_keys(self):
        r = self.client.get("/api/chat").json()
        self.assertEqual(r["active"], "env")
        self.assertEqual([t["id"] for t in r["llms"]], ["env"])
        self.assertNotIn("key", r["llms"][0])

    def test_sends_the_whole_conversation_and_answers(self):
        with patch.object(FakeLLM, "reply", "<think>easy</think>\nこんにちは！"):
            r = self.post({"llm": "env", "messages": [
                {"role": "assistant", "content": "a greeting left over"},  # dropped: the person speaks first
                {"role": "user", "content": "やあ"}, {"role": "assistant", "content": "やあ！"}, {"role": "user", "content": " 元気？ "}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["reply"], r.json()["name"]), ("こんにちは！", "From the environment"))
        sent = FakeLLM.requests[-1]["body"]["messages"]
        self.assertEqual(sent[0]["role"], "system")
        self.assertEqual([(m["role"], m["content"]) for m in sent[1:]], [("user", "やあ"), ("assistant", "やあ！"), ("user", "元気？")])
        self.assertFalse(Source.objects.exists())  # nothing kept

    def test_checks_the_conversation(self):
        for messages in ([], [{"role": "user", "content": "  "}], [{"role": "system", "content": "x"}],
                         [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
                         [{"role": "user", "content": "x" * 8001}]):
            self.assertEqual(self.post({"llm": "env", "messages": messages}).status_code, 400, messages)


class KeptChatTests(ChatTests):
    def convo(self, **kw):
        return Conversation.objects.create(owner=self.user, **kw)

    def test_keeps_the_turns_and_the_reply(self):
        c = self.convo()
        with patch.object(FakeLLM, "reply", "元気だよ"):
            r = self.post({"llm": "env", "conversation": c.pk, "messages": [{"role": "user", "content": "元気？\nまた明日"}]})
        self.assertEqual(r.json()["conversation"]["title"], "元気？")
        c.refresh_from_db()
        self.assertEqual(c.messages, [{"role": "user", "content": "元気？\nまた明日"},
                                      {"role": "assistant", "content": "元気だよ", "name": "From the environment"}])

    def test_keeps_what_you_wrote_when_the_model_fails(self):
        c = self.convo(title="Mine", archived=True)
        with patch.object(translate, "_converse", side_effect=translate.TranslateError("down")):
            r = self.post({"llm": "env", "conversation": c.pk, "messages": [{"role": "user", "content": "hi", "images": [PNG]}]})
        self.assertEqual(r.status_code, 503)
        c.refresh_from_db()
        self.assertEqual((c.title, c.archived, c.messages), ("Mine", False, [{"role": "user", "content": "hi", "images": [PNG]}]))

    def test_a_reply_to_a_chat_that_changed_meanwhile_is_not_kept(self):
        c = self.convo()

        def meanwhile(*a, **kw):
            Conversation.objects.filter(pk=c.pk).update(messages=[{"role": "user", "content": "newer"}], updated_at=timezone.now())
            return "late"
        with patch.object(translate, "_converse", side_effect=meanwhile):
            self.assertEqual(self.post({"llm": "env", "conversation": c.pk, "messages": [{"role": "user", "content": "older"}]}).status_code, 200)
        c.refresh_from_db()
        self.assertEqual(c.messages, [{"role": "user", "content": "newer"}])

    def test_another_persons_chat_is_not_found(self):
        other = Conversation.objects.create(owner=get_user_model().objects.create_user("other", password="a-long-test-password"))
        self.assertEqual(self.post({"llm": "env", "conversation": other.pk, "messages": [{"role": "user", "content": "hi"}]}).status_code, 404)
        self.assertEqual(self.client.get(f"/api/conversations/{other.pk}").status_code, 404)


class ConversationTests(SignedIn):
    def test_lists_rename_archive_and_delete(self):
        r = self.client.post("/api/conversations", {"messages": [{"role": "user", "content": "", "images": [PNG]},
                                                                 {"role": "assistant", "content": "a cat", "name": "Claude"}]},
                             content_type="application/json")
        self.assertEqual(r.status_code, 201)
        cid = r.json()["id"]
        self.assertEqual(r.json()["title"], "An image")
        listed = self.client.get("/api/conversations").json()
        self.assertEqual([(c["id"], "messages" in c) for c in listed], [(cid, False)])
        self.assertEqual(len(self.client.get(f"/api/conversations/{cid}").json()["messages"]), 2)

        patch_ = lambda data: self.client.patch(f"/api/conversations/{cid}", data, content_type="application/json")
        self.assertEqual(patch_({"title": "  "}).status_code, 400)
        other = Conversation.objects.create(owner=self.user, title="newer")
        self.assertTrue(patch_({"pinned": True}).json()["pinned"])
        self.assertEqual([c["id"] for c in self.client.get("/api/conversations").json()], [cid, other.pk])  # pinned first
        other.delete()
        self.assertEqual(patch_({"title": " 猫 ", "archived": True, "messages": []}).json()["title"], "猫")
        self.assertEqual(len(Conversation.objects.get(pk=cid).messages), 2)  # turns are written by chatting
        self.assertEqual(self.client.get("/api/conversations").json(), [])
        self.assertEqual([c["id"] for c in self.client.get("/api/conversations?archived=true").json()], [cid])

        self.assertEqual(self.client.delete(f"/api/conversations/{cid}").status_code, 204)
        self.assertFalse(Conversation.objects.exists())

    def test_checks_turns_brought_over(self):
        r = self.client.post("/api/conversations", {"messages": [{"role": "system", "content": "x"}]}, content_type="application/json")
        self.assertEqual(r.status_code, 400)


class ChatWithoutLLMTests(SignedIn):
    def test_says_to_add_one(self):
        self.assertEqual(self.client.get("/api/chat").json(), {"llms": [], "active": None})
        r = self.client.post("/api/chat", {"messages": [{"role": "user", "content": "hi"}]}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Add-ons", r.json()["error"])


PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


class ChatImageTests(ChatTests):
    def test_sends_images_the_way_openai_servers_take_them(self):
        r = self.post({"llm": "env", "messages": [{"role": "user", "content": "これは何？", "images": [PNG]}]})
        self.assertEqual(r.status_code, 200)
        content = FakeLLM.requests[-1]["body"]["messages"][1]["content"]
        self.assertEqual(content, [{"type": "image_url", "image_url": {"url": PNG}}, {"type": "text", "text": "これは何？"}])

    def test_an_image_alone_is_a_message(self):
        self.assertEqual(self.post({"llm": "env", "messages": [{"role": "user", "content": "", "images": [PNG]}]}).status_code, 200)
        self.assertEqual(FakeLLM.requests[-1]["body"]["messages"][1]["content"], [{"type": "image_url", "image_url": {"url": PNG}}])

    def test_only_the_latest_images_go_again(self):
        turns = []
        for i in range(3):
            turns += [{"role": "user", "content": f"{i}", "images": [PNG] * 4}, {"role": "assistant", "content": "ok"}]
        self.post({"llm": "env", "messages": turns[:-1]})
        sent = [m["content"] for m in FakeLLM.requests[-1]["body"]["messages"][1::2]]
        self.assertEqual(sent[0], "(4 images shared earlier)\n0")
        self.assertEqual([len(c) for c in sent[1:]], [5, 5])  # four images and the text

    def test_checks_the_images(self):
        for images in (["https://example.com/a.png"], ["data:image/svg+xml;base64,PHN2Zz4="], [PNG] * 5, "x"):
            r = self.post({"llm": "env", "messages": [{"role": "user", "content": "hi", "images": images}]})
            self.assertEqual(r.status_code, 400, images)

    def test_claude_takes_base64_blocks(self):
        from . import chat
        turn = {"content": "何？", "images": [("image/png", PNG.split(",")[1])]}
        self.assertEqual(chat._content(turn, "anthropic"), [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": PNG.split(",")[1]}},
            {"type": "text", "text": "何？"}])
