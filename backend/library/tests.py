from django.test import TestCase, SimpleTestCase
from . import romanize
from .models import Sentence, Source


class ContextReadingsTests(SimpleTestCase):
    def test_clock_hours_and_standalone_time(self):
        for text in ['三時です。', '3時です。', '３時です。']:
            self.assertIn(['時', 'じ'], romanize.furigana(text))
        self.assertIn(['時', 'とき'], romanize.furigana('その時、帰りました。'))
        self.assertIn(['時間', 'じかん'], romanize.furigana('時間があります。'))

    def test_okurigana_and_repeated_spans(self):
        self.assertIn(['食', 'た'], romanize.furigana('食べました。'))
        pairs = romanize.furigana('三時です。その時帰ります。')
        self.assertEqual([p[1] for p in pairs if p[0] == '時'], ['じ', 'とき'])


class SentenceDetailTests(TestCase):
    def setUp(self):
        self.source = Source.objects.create(kind='text', text='三時です。その時帰ります。')
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


class LabelTests(TestCase):
    def test_clean_labels_splits_commas(self):
        from .serializers import clean_labels
        self.assertEqual(clean_labels(["minna no nihongo, lesson 18"]), ["minna no nihongo", "lesson 18"])
        self.assertEqual(clean_labels("アニメ、第3話，  op "), ["アニメ", "第3話", "op"])
        self.assertEqual(clean_labels(["a", "A, b,,"]), ["a", "b"])

    def test_bulk_add_label_splits_and_respects_limit(self):
        s = Source.objects.create(kind="text", text="x", labels=["drama"])
        r = self.client.post("/api/sources/bulk", {"ids": [s.id], "add_label": "lesson 18, minna"}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        s.refresh_from_db()
        self.assertEqual(s.labels, ["drama", "lesson 18", "minna"])
        r = self.client.post("/api/sources/bulk", {"ids": [s.id], "add_label": "one more"}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        s.refresh_from_db()
        self.assertEqual(len(s.labels), 3)

    def test_patch_labels_splits(self):
        s = Source.objects.create(kind="text", text="x")
        r = self.client.patch(f"/api/sources/{s.id}", {"labels": ["a, b"]}, content_type="application/json")
        self.assertEqual(r.json()["labels"], ["a", "b"])
