import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from library import dictionary, translate, words
from library.models import Sentence, Source, Word
from library.tests_words import JMDICT

from . import heard, worker, ytdlp
from .models import Channel, Line, Term, Video


class ParsingCase(TestCase):
    def test_json3_joins_breaks_drops_noise_and_stops_at_the_next_cue(self):
        data = {"events": [
            {"tStartMs": 0, "dDurationMs": 4000, "segs": [{"utf8": "今、僕は成田空港に\nいます。"}]},
            {"tStartMs": 2500, "dDurationMs": 1000, "segs": [{"utf8": "[音楽]"}]},
            {"tStartMs": 3000, "dDurationMs": 2000, "segs": [{"utf8": "Suica"}]},  # no Japanese in it
            {"tStartMs": 3500, "dDurationMs": 2000, "segs": [{"utf8": "長かった"}, {"utf8": "ですね！"}]},
            {"tStartMs": 9000, "aAppend": 1},
        ]}
        self.assertEqual(ytdlp.parse_json3(data), [(0.0, 3.5, "今、僕は成田空港にいます。"), (3.5, 5.5, "長かったですね！")])

    def test_addresses(self):
        self.assertEqual(ytdlp.normalize("https://www.youtube.com/@kensanokaeri"), ("channel", "https://www.youtube.com/@kensanokaeri/videos"))
        self.assertEqual(ytdlp.normalize("@JapanesewithShun"), ("channel", "https://www.youtube.com/@JapanesewithShun/videos"))
        self.assertEqual(ytdlp.normalize("https://www.youtube.com/@x/streams"), ("channel", "https://www.youtube.com/@x/streams"))
        self.assertEqual(ytdlp.normalize("https://www.youtube.com/playlist?list=PLabc_1"), ("playlist", "https://www.youtube.com/playlist?list=PLabc_1"))
        with self.assertRaisesRegex(ValueError, "one video"):
            ytdlp.normalize("https://youtu.be/vmZ1MRGNLUM")
        with self.assertRaises(ValueError):
            ytdlp.normalize("https://example.com/@x")

    def test_only_human_japanese_subtitles_count(self):
        meta = {"subtitles": {"en": [{"ext": "json3", "url": "e"}], "ja-JP": [{"ext": "json3", "url": "p"}],
                              "ja": [{"ext": "vtt", "url": "v"}, {"ext": "json3", "url": "j"}]},
                "automatic_captions": {"ja": [{"ext": "json3", "url": "auto"}]}}
        self.assertEqual(ytdlp.japanese_track(meta), "ja")
        self.assertIsNone(ytdlp.japanese_track({"automatic_captions": meta["automatic_captions"]}))

    def test_subtitles_are_the_track_yt_dlp_saved(self):
        def run(args, timeout=0):
            self.assertEqual(json.loads(Path(args[args.index("--load-info-json") + 1]).read_text()), {"title": "x"})
            Path(args[args.index("-o") + 1]).with_name(f"subs.{args[args.index('--sub-langs') + 1]}.json3").write_text(json.dumps(
                {"events": [{"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "猫です"}]}]}))
            return ""
        with patch.object(ytdlp, "run", run):
            self.assertEqual(ytdlp.subtitles({"title": "x"}, "ja"), [(0.0, 1.0, "猫です")])
        with patch.object(ytdlp, "run", lambda a, t=0: ""), self.assertRaises(ytdlp.YtError):
            ytdlp.subtitles({"title": "x"}, "ja")

    def test_errors_say_what_kind(self):
        self.assertEqual(ytdlp._error("ERROR: [youtube] abc: This video is available to this channel's members on level: x").kind, "members")
        self.assertEqual(ytdlp._error("ERROR: [youtube] abc: Sign in to confirm you’re not a bot").kind, "throttled")
        e = ytdlp._error("WARNING: x\nERROR: [youtube] abcdefghijk: Video unavailable. This video has been removed by the uploader")
        self.assertEqual((e.kind, str(e)), ("gone", "Video unavailable. This video has been removed by the uploader"))


class HeardCase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.settings = override_settings(DATA_DIR=Path(cls.tmp.name), MEDIA_ROOT=Path(cls.tmp.name) / "files")
        cls.settings.enable()
        dictionary.build(iter(JMDICT))

    @classmethod
    def tearDownClass(cls):
        dictionary._local.__dict__.clear()
        cls.settings.disable()
        cls.tmp.cleanup()
        super().tearDownClass()

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for p in (patch.object(translate, "_SETTINGS", self.dir / "settings.json"), patch.object(heard, "AUDIO", self.dir / "heard"),
                  patch.object(worker, "kick", lambda: None), patch.object(words, "kick", lambda: None)):
            p.start()
            self.addCleanup(p.stop)
        heard.set_enabled(True)
        self.channel = Channel.objects.create(kind="channel", url="https://www.youtube.com/@a/videos", title="A")
        self.v1 = self._video("aaaaaaaaaaa", ["猫が好きです。", "犬も猫も本を読む。", "図書館で本を読む。"])
        self.v2 = self._video("bbbbbbbbbbb", ["本を読む。", "猫と犬と本。"])

    def _video(self, yt_id, texts):
        v = Video.objects.create(yt_id=yt_id, title=f"Video {yt_id[0]}", uploader="Ken", subs="ok", duration=60)
        v.channels.add(self.channel)
        lines = [Line.objects.create(video=v, position=i, start=i * 3.0, end=i * 3.0 + 2, text=t) for i, t in enumerate(texts)]
        heard.index_lines(lines)
        return v

    def _key(self, lemma):
        return Term.objects.get(lemma=lemma).key

    def test_lines_are_cut_into_dictionary_words_with_furigana(self):
        line = self.v1.lines.get(position=2)
        self.assertEqual({u.term.lemma for u in line.uses.all()}, {"図書館", "本", "読む"})
        self.assertEqual(line.words_engine, words.engine())
        self.assertIn(["図書", "としょ"], line.furigana)
        self.assertFalse(Word.objects.exists())  # terms aren't words you've met

    def test_easiest_lines_first_and_one_per_video_before_a_second(self):
        for lemma in ("猫", "読む"):
            Word.objects.create(key=self._key(lemma), lemma=lemma, known_at=timezone.now())
        out = heard.lines_for(Term.objects.get(lemma="本"), 0, 10)
        # every other word known first; then v1's best (one new word, 9 characters, the earlier
        # line of the two that tie), before either video's second
        self.assertEqual([(l["text"], l["new"]) for l in out["lines"]],
                         [("本を読む。", 0), ("犬も猫も本を読む。", 1), ("図書館で本を読む。", 1), ("猫と犬と本。", 1)])
        self.assertEqual((out["total"], out["videos"]), (4, 2))
        first = out["lines"][0]
        self.assertEqual(first["spans"], [[0, 1]])
        self.assertEqual((first["before"], first["after"]), (None, "猫と犬と本。"))

    def test_a_gone_video_is_left_out_unless_its_audio_is_here(self):
        self.v2.gone_at = timezone.now()
        self.v2.save()
        term = Term.objects.get(lemma="本")
        self.assertEqual(heard.lines_for(term)["total"], 2)
        heard.AUDIO.mkdir()
        (heard.AUDIO / "bbbbbbbbbbb.weba").write_bytes(b"x")
        self.assertEqual(heard.lines_for(term)["total"], 4)

    def test_heard_endpoint_and_off(self):
        r = self.client.get("/api/youtube/heard", {"key": self._key("猫")}).json()
        self.assertEqual((r["enabled"], r["total"], r["channels"]), (True, 3, 1))
        heard.set_enabled(False)
        r = self.client.get("/api/youtube/heard", {"key": self._key("猫")}).json()
        self.assertEqual((r["enabled"], r["lines"]), (False, []))
        self.assertEqual(self.client.post("/api/youtube/channels", {"url": "@b"}, content_type="application/json").status_code, 409)

    def test_keeping_makes_one_source_per_video_in_time_order(self):
        def fake_audio(yt_id, folder):
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{yt_id}.weba").write_bytes(b"audio")
            return folder / f"{yt_id}.weba"
        later, sooner = self.v1.lines.get(position=2), self.v1.lines.get(position=0)
        with patch.object(ytdlp, "audio", fake_audio), \
                patch.object(heard, "give_source_audio", lambda v: heard._give_source_audio(v.id)):  # no thread
            r = self.client.post(f"/api/youtube/lines/{later.id}/keep").json()
            self.client.post(f"/api/youtube/lines/{sooner.id}/keep")
        src = Source.objects.get(pk=r["source"])
        self.assertEqual((src.kind, src.status, src.title), ("audio", "inbox", "Video a"))
        self.assertEqual([s.text for s in src.sentences.order_by("position")], ["猫が好きです。", "図書館で本を読む。"])
        self.assertEqual(src.sentences.get(text="図書館で本を読む。").start, 6.0)
        self.assertEqual(src.media.name, "media/youtube-aaaaaaaaaaa.weba")
        self.assertTrue(Path(src.media.path).exists())
        # a kept line is yours now: it's not offered again, and keeping it twice changes nothing
        self.assertNotIn(later.id, heard.ranked(Term.objects.get(lemma="本")))
        self.assertEqual(self.client.post(f"/api/youtube/lines/{later.id}/keep").json()["sentence"], r["sentence"])
        self.assertEqual(Sentence.objects.count(), 2)

    def test_unfollowing_keeps_what_you_kept(self):
        line = self.v1.lines.get(position=0)
        with patch.object(heard, "give_source_audio"):
            heard.keep(line)
        self.assertEqual(self.client.delete(f"/api/youtube/channels/{self.channel.id}").status_code, 204)
        self.assertEqual(list(Video.objects.values_list("yt_id", flat=True)), ["aaaaaaaaaaa"])  # its source holds it
        self.assertEqual(Sentence.objects.get().text, "猫が好きです。")
        self.assertEqual(Line.objects.filter(video__yt_id="bbbbbbbbbbb").count(), 0)

    def test_a_word_page_for_a_word_not_yet_met(self):
        r = self.client.get("/api/dict/j:1").json()
        self.assertEqual((r["lemma"], r["reading"], r["word"]), ("図書館", "としょかん", None))
        self.assertEqual(r["entries"][0]["senses"][0]["gloss"], ["library"])
        self.assertEqual(self.client.get("/api/dict/j:999999").status_code, 404)

    def test_search_finds_lines_by_word_reading_and_meaning(self):
        for q in ("図書館", "toshokan", "library"):
            r = self.client.get("/api/youtube/search", {"q": q}).json()
            self.assertEqual([l["text"] for l in r["lines"]], ["図書館で本を読む。"], q)
            self.assertEqual(r["terms"][0]["lemma"], "図書館")

    def test_counts_for_the_lookup_sheet(self):
        r = self.client.get("/api/youtube/counts", {"keys": f"{self._key('犬')},j:999"}).json()
        self.assertEqual(r["counts"], {self._key("犬"): 2})

    def test_the_worker_reads_a_channel_then_its_videos(self):
        Channel.objects.all().delete()
        Video.objects.all().delete()
        ch = Channel.objects.create(kind="channel", url="https://www.youtube.com/@k/videos")
        subs = [(0.0, 2.0, "猫が好きです。"), (2.0, 4.0, "本を読む。")]
        meta = {"ccc": {"title": "With", "channel": "Ken", "upload_date": "20260102", "subtitles": {"ja": [{"ext": "json3", "url": "u"}]}},
                "ddd": {"title": "Without", "channel": "Ken", "automatic_captions": {"ja": []}}}

        def look(yt_id):
            if yt_id == "eee":
                raise ytdlp.YtError("Join this channel to get access to members-only content", "members")
            return meta[yt_id]
        with patch.object(ytdlp, "listing", lambda url: ("Ken", [{"id": i * 11, "title": ""} for i in "cde"])), \
                patch.object(ytdlp, "look", lambda yt: look(yt[0] * 3)), patch.object(ytdlp, "subtitles", lambda m, lang: subs), \
                patch.object(worker, "SUBS_GAP", 0), \
                patch.object(worker, "_update_due", lambda: False), \
                patch.object(worker, "PACE", (0, 0)):
            worker._run()
        ch.refresh_from_db()
        self.assertEqual(ch.title, "Ken")
        got = {v.yt_id[0]: (v.subs, v.lines.count()) for v in Video.objects.all()}
        self.assertEqual(got, {"c": ("ok", 2), "d": ("none", 0), "e": ("members", 0)})
        v = Video.objects.get(yt_id="c" * 11)
        self.assertEqual((v.title, v.uploader, str(v.published)), ("With", "Ken", "2026-01-02"))
        self.assertTrue(Term.objects.filter(lemma="猫").exists())


class ThrottleCase(TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for p in (patch.object(translate, "_SETTINGS", Path(tmp.name) / "settings.json"),
                  patch.object(worker, "PACE", (0, 0)), patch.object(worker, "_update_due", lambda: False),
                  patch.dict(worker.state, {"paused_until": 0.0, "backoff": 0})):
            p.start()
            self.addCleanup(p.stop)
        heard.set_enabled(True)

    def test_too_many_requests_leaves_videos_waiting_and_rests(self):
        ch = Channel.objects.create(kind="channel", url="u", checked_at=timezone.now())
        for i in "fgh":
            Video.objects.create(yt_id=i * 11).channels.add(ch)
        asked = []

        def look(yt_id):
            asked.append(yt_id[0])
            if yt_id[0] == "g":
                raise ytdlp._error("ERROR: Unable to download video subtitles for 'ja': HTTP Error 429: Too Many Requests")
            return {"title": "x"}
        with patch.object(ytdlp, "look", look):
            worker._run()
        self.assertEqual(dict(Video.objects.values_list("yt_id", "subs")), {"f" * 11: "none", "g" * 11: "waiting", "h" * 11: "waiting"})
        self.assertEqual(asked, ["f", "g"])  # h isn't asked for straight after YouTube said no
        self.assertGreater(worker.paused(), 0)
        self.assertEqual(worker.state["backoff"], 600)
        with patch.object(ytdlp, "look", look):
            worker._run()  # still resting: nothing asked
        self.assertEqual(Video.objects.get(yt_id="g" * 11).subs, "waiting")

    def test_subtitle_downloads_are_a_minute_apart_and_only_for_human_ones(self):
        ch = Channel.objects.create(kind="channel", url="u", checked_at=timezone.now())
        for i in "pqr":
            Video.objects.create(yt_id=i * 11).channels.add(ch)
        human = {"subtitles": {"ja": [{"ext": "json3", "url": "j"}]}}
        slept, downloads = [], []
        with patch.object(ytdlp, "look", lambda yt: {} if yt[0] == "q" else human), \
                patch.object(ytdlp, "subtitles", lambda m, lang: downloads.append(lang) or [(0.0, 1.0, "猫です")]), \
                patch.object(worker.time, "sleep", slept.append), patch.dict(worker.state, {"last_subs": 0.0}):
            worker._run()
        self.assertEqual(downloads, ["ja", "ja"])  # q has none to download
        self.assertEqual(len(slept), 1)  # before r's: p's was the first in a long while
        self.assertAlmostEqual(slept[0], worker.SUBS_GAP, delta=2)
        self.assertEqual(dict(Video.objects.values_list("yt_id", "subs")), {"p" * 11: "ok", "q" * 11: "none", "r" * 11: "ok"})


class RestartCase(TestCase):
    """kotoba stopped halfway through fetching something."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for p in (patch.object(translate, "_SETTINGS", self.dir / "settings.json"),
                  patch.dict(worker._tools, {"state": "", "error": ""})):
            p.start()
            self.addCleanup(p.stop)
        heard.set_enabled(True)

    def test_a_cut_short_install_is_fetched_again(self):
        asked = []
        with patch.object(ytdlp, "missing", lambda: True), patch.object(worker, "install_tools", lambda: asked.append(1)):
            worker.kick()
        self.assertEqual(asked, [1])
        with patch.object(ytdlp, "missing", lambda: True), patch.object(worker, "install_tools", lambda: asked.append(1)), \
                patch.dict(worker._tools, {"state": "failed"}):
            worker.kick()  # a failed fetch waits for you to turn it on again
        self.assertEqual(asked, [1])

    def test_audio_cut_short_is_neither_kept_nor_taken_as_done(self):
        incoming = self.dir / ".incoming"
        incoming.mkdir()
        (incoming / "abcdefghijk.webm").write_bytes(b"half")

        def run(args, timeout=0):
            out = Path(args[args.index("-o") + 1].replace("%(ext)s", "webm"))
            self.assertFalse(out.exists())
            out.write_bytes(b"whole")
            return f"{out}\n"
        with patch.object(ytdlp, "run", run):
            got = ytdlp.audio("abcdefghijk", self.dir)
        self.assertEqual((got, got.read_bytes()), (self.dir / "abcdefghijk.weba", b"whole"))
        self.assertEqual(list(incoming.iterdir()), [])
