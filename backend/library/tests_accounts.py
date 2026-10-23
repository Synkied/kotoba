import base64
import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from corpus.models import Channel, Line, Video
from .models import Deck, Explanation, Profile, Sentence, Source, Word
from .testing import SignedIn

User = get_user_model()


def quiet(test):
    """No background indexing, transcribing or YouTube reading while a test runs."""
    for name in ("library.words.kick", "speech.jobs.kick", "corpus.worker.kick"):
        p = patch(name)
        p.start()
        test.addCleanup(p.stop)


def png() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


class SigningInTests(TestCase):
    def setUp(self):
        cache.clear()  # the sign-in throttle counts across tests
        quiet(self)
        self.user = User.objects.create_user("aiko", password="a-long-test-password")

    def signin(self, password="a-long-test-password", username="aiko"):
        return self.client.post("/api/account/signin", {"username": username, "password": password}, content_type="application/json")

    def test_everything_needs_signing_in_but_health_and_the_way_in(self):
        self.assertEqual(self.client.get("/api/stats").status_code, 401)
        self.assertEqual(self.client.get("/api/sources").status_code, 401)
        self.assertEqual(self.client.post("/api/collect/text", {"text": "猫"}, content_type="application/json").status_code, 401)
        self.assertEqual(self.client.get("/api/health").json(), {"ok": True})
        self.assertEqual(self.client.get("/api/account").json(), {"user": None, "signup": False})

    def test_sign_in_and_out(self):
        self.assertEqual(self.signin("wrong").status_code, 400)
        r = self.signin()
        self.assertEqual(r.json()["user"]["username"], "aiko")
        self.assertEqual(self.client.get("/api/stats").status_code, 200)
        self.assertEqual(self.client.get("/api/account").json()["user"]["username"], "aiko")
        self.assertEqual(self.client.post("/api/account/signout").status_code, 204)
        self.assertEqual(self.client.get("/api/stats").status_code, 401)

    def test_too_many_tries_are_refused_for_a_while(self):
        for _ in range(10):
            self.signin("wrong")
        self.assertEqual(self.signin().status_code, 429)

    def test_sign_up_only_when_open(self):
        data = {"username": "ben", "password": "another-long-password"}
        self.assertEqual(self.client.post("/api/account/signup", data, content_type="application/json").status_code, 403)
        with override_settings(SIGNUP=True):
            self.assertEqual(self.client.get("/api/account").json()["signup"], True)
            weak = self.client.post("/api/account/signup", {"username": "ben", "password": "123"}, content_type="application/json")
            self.assertEqual(weak.status_code, 400)
            taken = self.client.post("/api/account/signup", {"username": "AIKO", "password": "another-long-password"},
                                     content_type="application/json")
            self.assertEqual(taken.json()["error"], "That username is taken.")
            r = self.client.post("/api/account/signup", data, content_type="application/json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.client.get("/api/account").json()["user"]["username"], "ben")
        self.assertFalse(User.objects.get(username="ben").is_staff)

    def test_change_password(self):
        self.signin()
        bad = self.client.post("/api/account/password", {"current": "nope", "new": "a-new-long-password"}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        r = self.client.post("/api/account/password", {"current": "a-long-test-password", "new": "a-new-long-password"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get("/api/stats").status_code, 200)  # still signed in here
        self.assertTrue(User.objects.get(pk=self.user.pk).check_password("a-new-long-password"))

    def test_another_site_cant_write_with_your_session(self):
        self.signin()
        r = self.client.post("/api/collect/text", {"text": "猫"}, content_type="application/json", HTTP_ORIGIN="https://evil.example")
        self.assertEqual(r.status_code, 403)


class TokenTests(SignedIn):
    def setUp(self):
        super().setUp()
        quiet(self)

    def test_screen_ocr_pushes_captures_with_a_token(self):
        token = self.client.get("/api/account/token").json()["token"]
        self.assertEqual(self.client.get("/api/account/token").json()["token"], token)  # the same until replaced
        capture = {"text": "猫です", "category": "game", "created_at": 1760000000, "image": png()}
        self.client.logout()
        self.assertEqual(self.client.post("/api/captures", capture, content_type="application/json").status_code, 401)
        r = self.client.post("/api/captures", capture, content_type="application/json", HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Source.objects.get(pk=r.json()["id"]).owner, self.user)

        self.client.force_login(self.user)
        new = self.client.post("/api/account/token").json()["token"]
        self.assertNotEqual(new, token)
        self.client.logout()
        self.assertEqual(self.client.get("/api/stats", HTTP_AUTHORIZATION=f"Token {token}").status_code, 401)
        self.assertEqual(self.client.get("/api/stats", HTTP_AUTHORIZATION=f"Token {new}").status_code, 200)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class IsolationTests(SignedIn):
    """Two learners on one kotoba: neither sees nor touches the other's library."""

    def setUp(self):
        super().setUp()
        quiet(self)
        self.other = User.objects.create_user("ben", password="a-long-test-password")
        self.theirs = Source.objects.create(owner=self.other, kind="text", text="犬です。", status="kept")
        self.their_sentence = Sentence.objects.create(source=self.theirs, text="犬です。")
        self.mine = Source.objects.create(owner=self.user, kind="text", text="猫です。", status="kept")
        self.my_sentence = Sentence.objects.create(source=self.mine, text="猫です。")

    def test_lists_and_pages_are_your_own(self):
        self.assertEqual([s["id"] for s in self.client.get("/api/sources").json()["results"]], [self.mine.id])
        self.assertEqual([s["id"] for s in self.client.get("/api/sentences").json()["results"]], [self.my_sentence.id])
        self.assertEqual(self.client.get(f"/api/sources/{self.theirs.id}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/sentences/{self.their_sentence.id}").status_code, 404)
        self.assertEqual(self.client.get("/api/stats").json()["sentences"], 1)
        self.assertEqual(self.client.get("/api/search", {"q": "犬"}).json()["counts"]["sentences"], 0)

    def test_cant_change_theirs_or_point_at_it(self):
        r = self.client.patch(f"/api/sentences/{self.their_sentence.id}", {"note": "mine now"}, content_type="application/json")
        self.assertEqual(r.status_code, 404)
        moved = self.client.patch(f"/api/sentences/{self.my_sentence.id}", {"source": self.theirs.id}, content_type="application/json")
        self.assertEqual(moved.status_code, 400)
        self.client.post("/api/sources/bulk", {"ids": [self.theirs.id], "delete": True}, content_type="application/json")
        self.assertTrue(Source.objects.filter(pk=self.theirs.id).exists())
        attempt = {"sentence": self.their_sentence.id, "model": "tts", "overall": 1, "accuracy": 1, "clarity": 1, "fluency": 1}
        self.assertEqual(self.client.post("/api/attempts", attempt, content_type="application/json").status_code, 400)
        note = self.client.post("/api/notes", {"title": "n", "source_ids": [self.theirs.id]}, content_type="application/json")
        self.assertEqual(note.status_code, 400)
        mention = self.client.post("/api/notes", {"title": "n", "body": f"[@dog](/sources/{self.theirs.id})"},
                                   content_type="application/json")
        self.assertEqual(mention.json()["sources"], [])
        deck = self.client.post("/api/decks", {"name": "Mine"}, content_type="application/json").json()
        self.client.post(f"/api/decks/{deck['id']}/add", {"sentences": [self.their_sentence.id, self.my_sentence.id]},
                         content_type="application/json")
        self.assertEqual(list(Deck.objects.get(pk=deck["id"]).sentences.values_list("id", flat=True)), [self.my_sentence.id])

    def test_new_things_are_yours(self):
        r = self.client.post("/api/collect/text", {"text": "本です。"}, content_type="application/json")
        self.assertEqual(Source.objects.get(pk=r.json()["id"]).owner, self.user)
        folder = self.client.post("/api/lesson-folders", {"name": "Book"}, content_type="application/json").json()
        lesson = self.client.post("/api/lessons", {"title": "One", "folder": folder["id"]}).json()
        note = self.client.post("/api/notes", {"title": "n"}, content_type="application/json").json()
        self.client.force_login(self.other)
        self.assertEqual(self.client.get("/api/lesson-folders").json(), [])
        self.assertEqual(self.client.get("/api/lessons").json(), [])
        self.assertEqual(self.client.get(f"/api/notes/{note['id']}").status_code, 404)
        self.assertEqual(self.client.post("/api/lessons", {"title": "Two", "folder": folder["id"]}).status_code, 400)
        self.assertEqual(self.client.get(f"/api/lessons/{lesson['id']}").status_code, 404)

    def test_files_go_only_to_their_owner(self):
        r = self.client.post("/api/captures", {"text": "猫", "category": "", "created_at": 1760000000, "image": png()},
                             content_type="application/json")
        url = Source.objects.get(pk=r.json()["id"]).image.url
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_each_has_their_own_words(self):
        from . import words
        words.index_pending()
        self.assertEqual(set(Word.objects.values_list("owner__username", "lemma")),
                         {("learner", "猫"), ("ben", "犬")})
        self.assertEqual([w["lemma"] for w in self.client.get("/api/words").json()["results"]], ["猫"])
        theirs = Word.objects.get(owner=self.other)
        self.assertEqual(self.client.patch(f"/api/words/{theirs.id}", {"known": True}, content_type="application/json").status_code, 404)


class SharedCorpusTests(SignedIn):
    def setUp(self):
        super().setUp()
        quiet(self)
        from corpus import heard
        self.other = User.objects.create_user("ben", password="a-long-test-password")
        for user in (self.user, self.other):
            heard.set_enabled(user, True)
        self.channel = Channel.objects.create(kind="channel", url="https://www.youtube.com/@a/videos", title="A")
        self.channel.followers.add(self.user, self.other)
        self.video = Video.objects.create(yt_id="aaaaaaaaaaa", subs="ok")
        self.video.channels.add(self.channel)
        self.line = Line.objects.create(video=self.video, position=0, start=0, end=1, text="猫です。")

    def test_keeping_is_per_user_and_unfollowing_leaves_it_for_others(self):
        from corpus import heard
        with patch.object(heard, "give_source_audio"):
            mine = self.client.post(f"/api/youtube/lines/{self.line.id}/keep").json()
            self.client.force_login(self.other)
            theirs = self.client.post(f"/api/youtube/lines/{self.line.id}/keep").json()
        self.assertNotEqual(mine["source"], theirs["source"])
        self.assertEqual(Source.objects.get(pk=theirs["source"]).owner, self.other)
        self.assertEqual(set(self.line.sentences.values_list("source__owner__username", flat=True)), {"learner", "ben"})

        self.assertEqual(self.client.delete(f"/api/youtube/channels/{self.channel.id}").status_code, 204)
        self.assertTrue(Channel.objects.filter(pk=self.channel.id).exists())  # the learner still follows it
        self.assertEqual(self.client.get("/api/youtube").json()["channels"], [])
        self.client.force_login(self.user)
        self.assertEqual([c["id"] for c in self.client.get("/api/youtube").json()["channels"]], [self.channel.id])

    def test_lines_of_channels_you_dont_follow_stay_out_of_reach(self):
        self.channel.followers.remove(self.user)
        self.assertEqual(self.client.get(f"/api/youtube/lines/{self.line.id}/context").status_code, 404)
        self.assertEqual(self.client.post(f"/api/youtube/lines/{self.line.id}/keep").status_code, 404)


class CommandTests(TestCase):
    def test_adduser(self):
        with patch("sys.stdin", io.StringIO("a-long-test-password\n")):
            call_command("adduser", "aiko", "--staff", "--password-stdin", stdout=io.StringIO())
        user = User.objects.get(username="aiko")
        self.assertTrue(user.is_staff and user.check_password("a-long-test-password"))

    def test_claim_data_gives_everything_unowned_to_one_user(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)):
            (Path(tmp) / "settings.json").write_text(json.dumps({
                "translate_to": "fr", "translator": "abc",
                "translators": [{"id": "abc", "kind": "openai", "name": "Mine", "url": "https://x/v1", "model": "m", "key": "sk"}],
                "youtube": {"enabled": True}}))
            user = User.objects.create_user("aiko", password="a-long-test-password")
            src = Source.objects.create(kind="text", text="猫")
            Sentence.objects.create(source=src, text="猫")
            Deck.objects.create(name="Old")
            Explanation.objects.create(lang="en", text="猫", translation="cat")
            old_cat = Word.objects.create(key="j:1", lemma="猫", known_at="2026-01-01T00:00Z")
            new_cat = Word.objects.create(owner=user, key="j:1", lemma="猫")  # made since accounts
            Word.objects.create(key="j:2", lemma="犬")
            channel = Channel.objects.create(kind="channel", url="u")
            out = io.StringIO()
            call_command("claim_data", "aiko", stdout=out)
            self.assertEqual(Source.objects.get().owner, user)
            self.assertEqual(Deck.objects.get().owner, user)
            self.assertEqual(Explanation.objects.get().owner, user)
            self.assertEqual(set(Word.objects.values_list("owner", "key")), {(user.id, "j:1"), (user.id, "j:2")})
            self.assertFalse(Word.objects.filter(pk=old_cat.pk).exists())
            self.assertIsNotNone(Word.objects.get(pk=new_cat.pk).known_at)
            self.assertEqual(list(channel.followers.all()), [user])
            saved = Profile.objects.get(user=user).settings
            self.assertEqual((saved["translate_to"], saved["translator"], saved["youtube"]), ("fr", "abc", {"enabled": True}))
            self.assertFalse((Path(tmp) / "settings.json").exists())
            self.assertTrue((Path(tmp) / "settings.json.claimed").exists())
            call_command("claim_data", stdout=out)  # the only user; nothing left to claim
            self.assertIn("Nothing was unowned.", out.getvalue())
