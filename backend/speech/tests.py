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
