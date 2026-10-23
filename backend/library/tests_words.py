import json
import tempfile
from pathlib import Path

from django.test import override_settings

from . import dictionary, words
from .models import Attempt, Sentence, Source, Word, WordUse
from .testing import SignedIn
from .tests_dictionary import _word


def _uk(id_, kanji, kana, gloss, pos="v5r"):
    """An entry JMdict marks as usually written in kana."""
    data = json.loads(_word(id_, kanji, kana, gloss, pos=pos))
    data["sense"][0]["misc"] = ["uk"]
    return json.dumps(data, ensure_ascii=False)


JMDICT = ['{\n', '"version": "3.6.2",\n', '"dictDate": "2026-10-05",\n', '"tags": {"n": "noun"},\n', '"words": [\n',
          _word(1, ["図書館"], ["としょかん"], "library") + ",\n",
          _word(2, ["図書"], ["としょ"], "books") + ",\n",
          _word(3, ["本"], ["ほん"], "book") + ",\n",
          _word(4, ["読む"], ["よむ"], "to read", pos="v5m") + ",\n",
          _word(5, ["市"], ["し"], "city") + ",\n",
          _uk(6, ["為る"], ["する"], "to do", pos="vs-i") + ",\n",
          _uk(7, ["分かる", "解る"], ["わかる"], "to understand") + ",\n",
          _word(8, ["繰る"], ["くる"], "to reel", pos="v5r") + ",\n",
          _word(9, ["来る"], ["くる"], "to come", pos="vk") + ",\n",
          _word(10, ["猫"], ["ねこ"], "cat") + ",\n",
          _word(11, ["犬"], ["いぬ"], "dog") + "\n", "]\n", "}\n"]


class WordsCase(SignedIn):
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

    def source(self, *lines, status=Source.Status.KEPT):
        src = Source.objects.create(owner=self.user, kind=Source.Kind.TEXT, status=status, text="\n".join(lines))
        for i, line in enumerate(lines):
            Sentence(source=src, position=i, text=line).save()
        return src

    def lemmas(self, text):
        return [(w["surface"], w["lemma"]) for w in words.segment(text)]


class SegmentTests(WordsCase):
    def test_compounds_and_endings(self):
        found = words.segment("図書館で本を読んでいました。")
        self.assertEqual([(w["surface"], w["lemma"], w["reading"]) for w in found],
                         [("図書館", "図書館", "としょかん"), ("本", "本", "ほん"), ("読んでいました", "読む", "よむ")])
        self.assertEqual((found[2]["start"], found[2]["end"]), (6, 13))
        self.assertEqual(found[0]["key"], "j:1")

    def test_conjugated_words_are_filed_under_their_dictionary_form(self):
        self.assertEqual(self.lemmas("ゲームをして"), [("ゲーム", "ゲーム"), ("して", "する")])  # not 市
        self.assertIn(("きました", "来る"), self.lemmas("きました"))  # not 繰る

    def test_usually_kana_words_and_spellings_meet(self):
        a, b = words.segment("分かりません"), words.segment("わかりました")
        self.assertEqual((a[0]["lemma"], a[0]["key"]), ("わかる", "j:7"))
        self.assertEqual(b[0]["key"], "j:7")

    def test_unlisted_nouns_keep_their_suffixes_but_not_desu(self):
        self.assertEqual(self.lemmas("お母さんは日本人です。"), [("お母さん", "お母さん"), ("日本人", "日本人")])

    def test_numbers_and_punctuation_are_not_words(self):
        self.assertEqual(self.lemmas("2026年。"), [])  # 年 counts the number

    def test_lines_keep_their_offsets(self):
        found = words.segment("猫\n犬")
        self.assertEqual([(w["lemma"], w["start"]) for w in found], [("猫", 0), ("犬", 2)])


class IndexTests(WordsCase):
    def test_index_and_read_again_after_an_edit(self):
        src = self.source("猫を読む")
        self.assertEqual(words.index_pending(), 1)
        s = src.sentences.get()
        self.assertEqual(s.word_uses.count(), 2)
        self.assertEqual(words.pending(self.user), 0)
        # a score doesn't change its words; new text does
        s.last = 90
        s.save(update_fields=["last"])
        self.assertEqual(words.pending(self.user), 0)
        s.text = "犬"
        s.save()
        self.assertEqual(words.pending(self.user), 1)
        words.index_pending()
        self.assertEqual(list(s.word_uses.values_list("word__lemma", flat=True)), ["犬"])
        # 猫 went with its last sentence; 読む too
        self.assertFalse(Word.objects.filter(lemma="猫").exists())

    def test_known_words_stay_without_sentences(self):
        src = self.source("猫")
        words.index_pending()
        Word.objects.filter(lemma="猫").update(known_at="2026-10-01T00:00:00Z")
        src.delete()
        words.tidy()
        self.assertTrue(Word.objects.filter(lemma="猫").exists())

    def test_engine_change_reads_everything_again(self):
        self.source("猫")
        words.index_pending()
        Sentence.objects.update(words_engine="old")
        self.assertEqual(words.pending(self.user), 1)


class WordApiTests(WordsCase):
    def setUp(self):
        super().setUp()
        self.a = self.source("猫が本を読む", "犬が本を読む")
        self.b = self.source("猫と図書館")
        self.archived = self.source("猫", status=Source.Status.ARCHIVED)
        words.index_pending()
        self.cat = Word.objects.get(lemma="猫")

    def test_list_counts_kept_sentences_only(self):
        r = self.client.get("/api/words").json()
        rows = {w["lemma"]: w for w in r["results"]}
        self.assertEqual((rows["猫"]["sentences"], rows["猫"]["sources"]), (2, 2))
        self.assertEqual(r["results"][0]["lemma"], "本")  # in the most sentences, with 猫 and 読む
        self.assertEqual(r["pending"], 0)
        self.assertEqual(self.client.get("/api/words?q=neko").json()["results"][0]["lemma"], "猫")
        self.assertEqual(self.client.get("/api/words?q=読んだ").json()["count"], 0)
        self.assertEqual(self.client.get("/api/words?q=読む").json()["results"][0]["lemma"], "読む")

    def test_known_and_practised(self):
        r = self.client.patch(f"/api/words/{self.cat.id}", {"known": True}, content_type="application/json").json()
        self.assertEqual(r["status"], "known")
        s = self.a.sentences.get(position=1)
        s.last = 95
        s.save(update_fields=["last"])
        statuses = {w["lemma"]: w["status"] for w in self.client.get("/api/words").json()["results"]}
        self.assertEqual((statuses["猫"], statuses["犬"], statuses["図書館"]), ("known", "practised", "new"))
        self.assertEqual([w["lemma"] for w in self.client.get("/api/words?status=new").json()["results"]], ["図書館"])

    def test_detail_lists_sentences_with_spans(self):
        r = self.client.get(f"/api/words/{self.cat.id}").json()
        self.assertEqual(len(r["sentence_list"]), 2)  # not the archived one
        self.assertEqual(r["sentence_list"][0]["spans"], [[0, 1]])
        self.assertEqual(r["entries"][0]["senses"][0]["gloss"], ["cat"])
        self.assertEqual(r["kanji"], [{"char": "猫", "words": 1}])

    def test_trouble_from_scored_attempts(self):
        s = self.a.sentences.get(position=0)  # 猫が本を読む
        units = [{"text": "猫", "status": "missed"}, *({"text": c, "status": "ok"} for c in "が本を読む")]
        for _ in range(2):
            Attempt.objects.create(sentence=s, overall=50, accuracy=50, clarity=50, fluency=50, units=units)
        r = self.client.get("/api/words?status=trouble").json()
        self.assertEqual([(w["lemma"], w["tries"], w["misses"]) for w in r["results"]], [("猫", 2, 2)])

    def test_sentence_words_and_related(self):
        s = self.a.sentences.get(position=0)
        r = self.client.get(f"/api/sentences/{s.id}/words").json()
        self.assertEqual([(w["lemma"], w["start"], w["end"]) for w in r["words"]], [("猫", 0, 1), ("本", 2, 3), ("読む", 4, 6)])
        self.assertEqual([x["sentence"]["text"] for x in r["related"]], ["猫と図書館"])  # its neighbour is left out

    def test_next_sentences_are_one_word_away(self):
        Word.objects.filter(lemma__in=["猫", "本"]).update(known_at="2026-10-01T00:00:00Z")
        r = self.client.get("/api/words/next").json()
        self.assertEqual({(x["sentence"]["text"], x["word"]["lemma"]) for x in r["results"]},
                         {("猫が本を読む", "読む"), ("猫と図書館", "図書館")})
        self.assertEqual(r["results"][0]["word"]["lemma"], "読む")  # in two sentences

    def test_source_coverage(self):
        Word.objects.filter(lemma="猫").update(known_at="2026-10-01T00:00:00Z")
        r = self.client.get(f"/api/sources/{self.a.id}/words").json()
        self.assertEqual((r["words"], r["known"], r["new"]), (4, 1, 3))
        self.assertEqual(r["top_new"][0]["lemma"], "本")

    def test_lookup_links_to_the_word(self):
        r = self.client.get("/api/lookup", {"text": "本を読んでいた", "at": 2}).json()
        self.assertEqual(r["library"]["id"], Word.objects.get(lemma="読む").id)
        self.assertEqual(r["library"]["sentences"], 2)


class SearchTests(WordsCase):
    def setUp(self):
        super().setUp()
        self.src = self.source("猫が本を読む", "図書館")
        Source.objects.filter(pk=self.src.pk).update(title="Cat book")
        words.index_pending()

    def search(self, q):
        return self.client.get("/api/search", {"q": q}).json()

    def test_words_by_spelling_romaji_meaning_and_kanji(self):
        self.assertEqual([w["lemma"] for w in self.search("猫")["words"]], ["猫"])
        self.assertEqual([w["lemma"] for w in self.search("neko")["words"]], ["猫"])
        cat = self.search("cat")["words"]
        self.assertEqual([w["lemma"] for w in cat], ["猫"])  # by meaning; not the books of 図書
        self.assertEqual(cat[0]["meaning"], "cat")
        self.assertEqual([w["lemma"] for w in self.search("図")["words"]], ["図書館"])
        # the words page searches the same way
        self.assertEqual([w["lemma"] for w in self.client.get("/api/words", {"q": "cat"}).json()["results"]], ["猫"])

    def test_sentences_by_text_and_translation(self):
        s = self.src.sentences.get(position=0)
        s.translations = {"en": "The cat reads a book."}
        s.save(update_fields=["translations"])
        self.assertEqual([x["text"] for x in self.search("reads")["sentences"]], ["猫が本を読む"])
        self.assertEqual(self.search("図書館")["counts"]["sentences"], 1)
        self.assertEqual([x["text"] for x in self.search("読んだ")["sentences"]], [])
        self.assertEqual([x["text"] for x in self.search("読む")["sentences"]], ["猫が本を読む"])
        self.assertEqual([x["text"] for x in self.search("library")["sentences"]], ["図書館"])  # by its word's meaning
        # the sentence list finds the same
        self.assertEqual([x["text"] for x in self.client.get("/api/sentences", {"q": "library"}).json()["results"]], ["図書館"])

    def test_sources_lessons_and_decks(self):
        from .models import Deck, Lesson
        Lesson.objects.create(owner=self.user, title="Cat lesson")
        Deck.objects.create(owner=self.user, name="Cats")
        r = self.search("cat")
        self.assertEqual(([x["title"] for x in r["sources"]], [x["title"] for x in r["lessons"]], [x["name"] for x in r["decks"]]),
                         (["Cat book"], ["Cat lesson"], ["Cats"]))

    def test_empty_query(self):
        self.assertEqual(self.search(" ")["words"], [])
