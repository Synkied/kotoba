import json
from unittest.mock import patch
from urllib.parse import urlencode

from django.test import SimpleTestCase


class PracticeRecordingTests(SimpleTestCase):
    @patch("speech.views.engine.whisper_installed", return_value=True)
    @patch("speech.views.engine.whisper_key", return_value=("small", "cpu", "int8"))
    @patch("speech.views.engine.score", return_value=({"said": "こんにちは"}, 200))
    def test_raw_pcm_scoring_uses_query_settings(self, score, whisper_key, installed):
        pcm = b"\x00\x00\xff\x7f\x00\x80"
        query = urlencode({"expected": "こんにちは", "final": "1",
                           "model": "small", "device": "cpu", "compute_type": "int8"})

        response = self.client.post(f"/api/engine/score?{query}", data=pcm,
                                    content_type="application/octet-stream")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"said": "こんにちは"})
        whisper_key.assert_called_once_with({"model": "small", "device": "cpu", "compute_type": "int8"})
        self.assertEqual(score.call_args.args, (pcm, "こんにちは", True, ("small", "cpu", "int8")))


class NonSpeechCleanupTests(SimpleTestCase):
    def test_preserve_non_speech_at_start_middle_and_end(self):
        from speech import cleanup, jpcut
        words = {'words': [
            {'word': 'こんにちは', 'start': 10, 'end': 11},
            {'word': 'ありがとう', 'start': 25, 'end': 26},
        ]}
        _, trimmed = jpcut.analyze(words, 40, cleanup.make_args({}))
        self.assertTrue(trimmed)
        self.assertTrue(all(reason == 'pause' for _, _, reason in trimmed))
        settings = cleanup.clean_settings({'no_pauses': True})
        _, preserved = jpcut.analyze(words, 40, cleanup.make_args(settings))
        self.assertEqual(preserved, [])

    def test_preserving_gaps_still_removes_speech_fillers(self):
        from speech import cleanup, jpcut
        words = {'words': [
            {'word': 'こんにちは', 'start': 10, 'end': 11},
            {'word': 'えーと', 'start': 12, 'end': 13},
            {'word': 'ありがとう', 'start': 14, 'end': 15},
        ]}
        _, cuts = jpcut.analyze(words, 40, cleanup.make_args({'no_pauses': True}))
        self.assertTrue(any('filler' in reason for _, _, reason in cuts))
        self.assertFalse(any(reason == 'pause' for _, _, reason in cuts))


class KokoroLoadTests(SimpleTestCase):
    def setUp(self):
        from speech import engine
        self.engine = engine
        self.addCleanup(engine._kokoro.update, dict(engine._kokoro))
        engine._kokoro.update(pipeline=None, error=None, loading=False)

    def test_load_reports_loading_until_the_pipeline_is_ready(self):
        import threading
        release = threading.Event()

        def pipeline():
            release.wait(5)
            self.engine._kokoro["pipeline"] = object()

        with patch.object(self.engine, "kokoro_installed", return_value=True), \
                patch.object(self.engine, "_kokoro_pipeline", side_effect=pipeline):
            first = self.client.post("/api/engine/tts/load").json()
            again = self.client.post("/api/engine/tts/load").json()
            release.set()
            for _ in range(100):
                if not self.engine._kokoro["loading"]:
                    break
                threading.Event().wait(0.01)
            done = self.client.post("/api/engine/tts/load").json()

        self.assertEqual(first["kokoro"], "loading")
        self.assertEqual(again["kokoro"], "loading")
        self.assertEqual(done["kokoro"], "ready")

    def test_load_without_kokoro_installed_does_nothing(self):
        with patch.object(self.engine, "kokoro_installed", return_value=False):
            self.assertEqual(self.client.post("/api/engine/tts/load").json(), {"kokoro": "missing", "kokoro_error": None})


class VoicevoxReadingTests(SimpleTestCase):
    def test_voicevox_says_the_furigana(self):
        from library import romanize
        from speech.engine import _voicevox_kana
        said = romanize.spoken("日本人のお母さんと一緒に写真を見ます。")
        self.assertEqual(_voicevox_kana("ニッポンジンノ/オハハ'サント/イッショニ/シャ'シンオ/ミマ'_ス", said),
                         "ニホンジンノ/オカア'サント/イッショニ/シャ'シンオ/ミマ'_ス")
        self.assertIsNone(_voicevox_kana("ワタシワ/ガ_クセ'エデス", romanize.spoken("私は学生です")))
        self.assertIsNone(_voicevox_kana("サ'ンジデス", romanize.spoken("3時です")))  # digits left to VOICEVOX
        self.assertEqual(_voicevox_kana("キ'ャクワ", "ヒャクワ"), "ヒャ'クワ")

    @patch("speech.engine._vv")
    def test_tts_uses_saved_sentence_readings(self, vv):
        from speech import engine
        engine._tts_cache.clear()
        vv.side_effect = lambda path, params, body=None, timeout=20: (
            json.dumps({"kana": "ニホ'ンジンデス", "accent_phrases": []}).encode() if path == "/audio_query"
            else b"[]" if path == "/accent_phrases" else b"RIFF")
        engine.tts("日本人です", "voicevox:1", 1, [["日本", "にっぽん"], ["人", "じん"]])
        kana = [c.args[1]["text"] for c in vv.call_args_list if c.args[0] == "/accent_phrases"]
        self.assertEqual(kana, ["ニッポ'ンジンデス"])
