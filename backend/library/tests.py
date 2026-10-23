import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings
from . import romanize
from .models import Attempt, Sentence, Source
from .testing import SignedIn


class ContextReadingsTests(SimpleTestCase):
    def test_clock_hours_and_standalone_time(self):
        for text in ['三時です。', '3時です。', '３時です。']:
            self.assertIn(['時', 'じ'], romanize.furigana(text))
        self.assertIn(['時', 'とき'], romanize.furigana('その時、帰りました。'))
        self.assertIn(['時間', 'じかん'], romanize.furigana('時間があります。'))

    def test_context_readings_unidic_lite_misses(self):
        pairs = romanize.furigana('日本人のお母さんと一緒に写真を見ます。')
        self.assertIn(['日本', 'にほん'], pairs)
        self.assertIn(['人', 'じん'], pairs)
        self.assertIn(['母', 'かあ'], pairs)
        self.assertIn(['人', 'にん'], romanize.furigana('三人です。'))
        self.assertIn(['母', 'はは'], romanize.furigana('母は元気です。'))
        self.assertIn(['私', 'わたし'], romanize.furigana('私は学生です。'))

    def test_spoken_follows_furigana(self):
        self.assertEqual(romanize.spoken('私は東京へ行きます。'), 'ワタシワトウキョウエイキマス。')
        self.assertEqual(romanize.spoken('日本人です', [['日本人', 'にっぽんじん']]), 'ニッポンジンデス')
        self.assertEqual(romanize.spoken('3時です'), '3ジデス')

    def test_okurigana_and_repeated_spans(self):
        self.assertIn(['食', 'た'], romanize.furigana('食べました。'))
        pairs = romanize.furigana('三時です。その時帰ります。')
        self.assertEqual([p[1] for p in pairs if p[0] == '時'], ['じ', 'とき'])


class SentenceDetailTests(SignedIn):
    def setUp(self):
        super().setUp()
        self.source = Source.objects.create(owner=self.user, kind='text', text='三時です。その時帰ります。')
        self.sentence = Sentence.objects.create(source=self.source, text=self.source.text)
        self.url = f'/api/sentences/{self.sentence.id}'

    def test_retrieve_and_saved_corrections(self):
        self.assertEqual(self.client.get(self.url).status_code, 200)
        pairs = self.sentence.furigana
        pairs[0][1] = 'み'
        response = self.client.patch(self.url, {'reading_overrides': pairs}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['furigana'], pairs)
        self.assertIn('mi', response.json()['roman'])
        self.client.patch(self.url, {'note': 'Remember this'}, content_type='application/json')
        self.sentence.refresh_from_db()
        self.assertEqual(self.sentence.reading_overrides, pairs)
        self.client.patch(self.url, {'reading_overrides': []}, content_type='application/json')
        self.sentence.refresh_from_db()
        self.assertEqual(self.sentence.reading_overrides, [])
        self.assertIn(['三', 'さん'], self.sentence.furigana)

    def test_invalid_readings_and_text_changes(self):
        for value in ['oops', [['時', 'ji']], [['wrong', 'じ']], [[1, 'じ']]]:
            response = self.client.patch(self.url, {'reading_overrides': value}, content_type='application/json')
            self.assertEqual(response.status_code, 400, response.content)
        pairs = self.sentence.furigana
        self.client.patch(self.url, {'reading_overrides': pairs}, content_type='application/json')
        response = self.client.patch(self.url, {'text': 'その時です。'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reading_overrides'], [])
        self.assertIn(['時', 'とき'], response.json()['furigana'])

    def test_text_readings_and_translation_in_one_save(self):
        text = 'その時、三人で帰りました。'
        pairs = self.client.get('/api/furigana', {'text': text}).json()['furigana']
        self.assertEqual(pairs, romanize.furigana(text))
        pairs = [[k, 'とき' if k == '時' else r] for k, r in pairs]
        response = self.client.patch(self.url, {'text': text, 'reading_overrides': pairs, 'translations': {'en': 'Then three of us went home.'}},
                                     content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], text)
        self.assertEqual(response.json()['furigana'], pairs)
        self.assertEqual(response.json()['translations'], {'en': 'Then three of us went home.'})


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class KeptTakeTests(SignedIn):
    def setUp(self):
        super().setUp()
        source = Source.objects.create(owner=self.user, kind='text', text='三時です。')
        self.sentence = Sentence.objects.create(source=source, text=source.text)
        out = self.client.post('/api/attempts', {'sentence': self.sentence.id, 'model': 'tts', 'overall': 60,
                                                 'accuracy': 60, 'clarity': 60, 'fluency': 60}, content_type='application/json')
        self.attempt = Attempt.objects.get(pk=out.json()['attempt']['id'])
        self.url = f'/api/attempts/{self.attempt.id}/audio'

    def keep(self, pcm=b'\x01\x00' * 16000):
        return self.client.put(self.url, pcm, content_type='application/octet-stream')

    def test_keep_replace_and_let_go(self):
        r = self.keep()
        self.assertEqual(r.status_code, 200, r.content)
        first = Path(Attempt.objects.get(pk=self.attempt.id).audio.path)
        self.assertEqual(first.read_bytes()[:4], b'RIFF')
        stamp = self.client.get(f'/api/sentences/{self.sentence.id}').json()['stamps'][0]
        self.assertTrue(stamp['audio'].startswith('/files/takes/'))
        self.keep(b'\x02\x00' * 8000)
        self.assertEqual([p.stat().st_size for p in first.parent.iterdir()], [44 + 16000])
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(Attempt.objects.get(pk=self.attempt.id).audio)
        self.assertEqual(Attempt.objects.count(), 1)

    def test_bad_take_and_cascade(self):
        self.assertEqual(self.keep(b'\x01').status_code, 400)
        self.assertEqual(self.keep(b'').status_code, 400)
        self.keep()
        path = Path(Attempt.objects.get(pk=self.attempt.id).audio.path)
        self.sentence.delete()
        self.assertFalse(path.exists())


class UntranslatableTests(SignedIn):
    def test_bare_numbers_translate_as_themselves(self):
        from unittest import mock
        from . import translate
        source = Source.objects.create(owner=self.user, kind='text', text='1\nこれ、ご主人ですか。')
        number = Sentence.objects.create(source=source, text='1', position=0,
                                         translations={'en': 'Is this your husband?'})
        Sentence.objects.create(source=source, text='これ、ご主人ですか。', position=1)
        with mock.patch.object(translate, '_ask', side_effect=AssertionError('no model call')):
            self.assertEqual(translate.translate(number, 'en'), '1')
        number.refresh_from_db()
        self.assertEqual(number.translations, {'en': '1'})
        for text in ['1', '１２.', '(3)', '—']:
            self.assertTrue(translate.untranslatable(text), text)
        for text in ['一', '問題1', 'Q1', 'これ']:
            self.assertFalse(translate.untranslatable(text), text)


class LabelTests(SignedIn):
    def test_clean_labels_splits_commas(self):
        from .serializers import clean_labels
        self.assertEqual(clean_labels(["minna no nihongo, lesson 18"]), ["minna no nihongo", "lesson 18"])
        self.assertEqual(clean_labels("アニメ、第3話，  op "), ["アニメ", "第3話", "op"])
        self.assertEqual(clean_labels(["a", "A, b,,"]), ["a", "b"])

    def test_bulk_add_label_splits_and_respects_limit(self):
        s = Source.objects.create(owner=self.user, kind="text", text="x", labels=["drama"])
        r = self.client.post("/api/sources/bulk", {"ids": [s.id], "add_label": "lesson 18, minna"}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        s.refresh_from_db()
        self.assertEqual(s.labels, ["drama", "lesson 18", "minna"])
        r = self.client.post("/api/sources/bulk", {"ids": [s.id], "add_label": "one more"}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        s.refresh_from_db()
        self.assertEqual(len(s.labels), 3)

    def test_patch_labels_splits(self):
        s = Source.objects.create(owner=self.user, kind="text", text="x")
        r = self.client.patch(f"/api/sources/{s.id}", {"labels": ["a, b"]}, content_type="application/json")
        self.assertEqual(r.json()["labels"], ["a", "b"])

    def test_deck_folder_is_saved_tidied(self):
        r = self.client.post("/api/decks", {"name": "Lesson 1", "folder": "  Minna   no Nihongo "}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["folder"], "Minna no Nihongo")
        r = self.client.patch(f"/api/decks/{r.json()['id']}", {"folder": ""}, content_type="application/json")
        self.assertEqual(r.json()["folder"], "")


class SentenceListFilterTests(SignedIn):
    def setUp(self):
        super().setUp()
        from django.utils import timezone
        audio = Source.objects.create(owner=self.user, kind='audio', status='kept', text='a')
        text = Source.objects.create(owner=self.user, kind='text', status='archived', text='b')
        self.heard = Sentence.objects.create(source=audio, text='聞きました。', last=80, due=timezone.now())
        self.fresh = Sentence.objects.create(source=audio, text='見ました。', position=1)
        self.read = Sentence.objects.create(source=text, text='読みました。')

    def ids(self, query):
        response = self.client.get('/api/sentences?' + query)
        self.assertEqual(response.status_code, 200, response.content)
        return {s['id'] for s in response.json()['results']}

    def test_kind_practice_and_status(self):
        self.assertEqual(self.ids('kind=audio,video'), {self.heard.id, self.fresh.id})
        self.assertEqual(self.ids('kind=text'), {self.read.id})
        self.assertEqual(self.ids('practice=new'), {self.fresh.id, self.read.id})
        self.assertEqual(self.ids('practice=practised'), {self.heard.id})
        self.assertEqual(self.ids('practice=due'), {self.heard.id})
        self.assertEqual(self.ids('status=archived'), {self.read.id})
        self.assertEqual(self.ids('kind=audio&practice=new'), {self.fresh.id})
