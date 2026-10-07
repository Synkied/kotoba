import json
import tempfile
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase, override_settings

from . import dictionary


def _word(id_, kanji, kana, *glosses, pos="n"):
    sense = {"partOfSpeech": [pos], "appliesToKanji": ["*"], "appliesToKana": ["*"], "related": [], "antonym": [],
             "field": [], "dialect": [], "misc": [], "info": [], "languageSource": [],
             "gloss": [{"lang": "eng", "gender": None, "type": None, "text": g} for g in glosses]}
    return json.dumps({"id": str(id_), "kanji": [{"common": True, "text": k, "tags": []} for k in kanji],
                       "kana": [{"common": True, "text": k, "tags": [], "appliesToKanji": ["*"]} for k in kana],
                       "sense": [sense]}, ensure_ascii=False)


# the jmdict-simplified layout: a header, then one entry per line
JMDICT = ['{\n', '"version": "3.6.2",\n', '"dictDate": "2026-10-05",\n', '"tags": {"n": "noun", "v1": "Ichidan verb"},\n', '"words": [\n',
          _word(1, ["図書館"], ["としょかん"], "library") + ",\n",
          _word(2, ["図書"], ["としょ"], "books") + ",\n",
          _word(3, ["食べる"], ["たべる"], "to eat", pos="v1") + ",\n",
          _word(4, ["今日"], ["きょう"], "today") + ",\n",
          _word(5, ["今日は"], ["こんにちは"], "hello") + ",\n",
          _word(6, [], ["アイスクリーム"], "ice cream") + "\n", "]\n", "}\n"]


class LookupTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.settings = override_settings(DATA_DIR=Path(cls.tmp.name))
        cls.settings.enable()
        dictionary.build(iter(JMDICT))

    @classmethod
    def tearDownClass(cls):
        dictionary._local.__dict__.clear()
        cls.settings.disable()
        cls.tmp.cleanup()
        super().tearDownClass()

    def look(self, text, word):
        return dictionary.lookup(text, text.index(word))

    def test_compound_is_one_word(self):
        w = self.look("図書館で勉強する。", "館")
        self.assertEqual((w["surface"], w["reading"], w["romaji"]), ("図書館", "としょかん", "toshokan"))
        self.assertEqual(w["furigana"], [["図書", "としょ"], ["館", "かん"]])
        self.assertEqual(w["entries"][0]["senses"][0]["gloss"], ["library"])
        self.assertEqual(w["entries"][0]["senses"][0]["pos"], ["noun"])

    def test_conjugation_stays_with_its_word(self):
        w = self.look("パンを食べました。", "食")
        self.assertEqual((w["surface"], w["lemma"], w["lemma_reading"]), ("食べました", "食べる", "たべる"))
        self.assertEqual(w["entries"][0]["senses"][0]["gloss"], ["to eat"])

    def test_particle_is_not_swallowed_into_a_greeting(self):
        w = self.look("今日は雨です。", "今")
        self.assertEqual((w["surface"], w["reading"]), ("今日", "きょう"))

    def test_katakana_and_punctuation(self):
        self.assertEqual(self.look("アイスクリームが好き", "ク")["entries"][0]["senses"][0]["gloss"], ["ice cream"])
        self.assertIsNone(self.look("雨。", "。"))

    def test_api(self):
        r = self.client.get("/api/lookup", {"text": "図書館", "at": 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["word"]["surface"], "図書館")
        self.assertEqual(r.json()["dictionary"]["state"], "ready")
        self.assertEqual(self.client.get("/api/lookup", {"text": "x", "at": "?"}).status_code, 400)


class MissingDictionaryTests(SimpleTestCase):
    def test_reading_without_dictionary_and_download_started(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(DATA_DIR=Path(tmp)), \
                mock.patch.object(dictionary.threading, "Thread") as thread:
            r = self.client.get("/api/lookup", {"text": "食べました", "at": 0}).json()
            thread.return_value.start.assert_called_once()
            dictionary._state["downloading"] = False
        self.assertEqual(r["word"]["reading"], "たべました")
        self.assertEqual(r["word"]["entries"], [])
