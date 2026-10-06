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
