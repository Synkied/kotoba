import io
import json
import wave
from unittest.mock import patch

from django.test import TestCase

from . import stories
from .models import Lesson, Source, Syllabus, SyllabusUnit
from .testing import SignedIn


def tone(seconds=0.5, rate=24000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\1\0" * int(rate * seconds))
    return buf.getvalue()


class ListTests(TestCase):
    def test_vocab_is_read_from_what_people_paste(self):
        self.assertEqual(stories.parse_vocab("会社員 かいしゃいん — company employee\n\n医者（いしゃ） - doctor\nわたし\n"
                                             "銀行\tぎんこう\tbank\n- 学生 がくせい = student"),
                         [["会社員", "かいしゃいん", "company employee"], ["医者", "いしゃ", "doctor"], ["わたし", "", ""],
                          ["銀行", "ぎんこう", "bank"], ["学生", "がくせい", "student"]])

    def test_grammar_lines_keep_their_note(self):
        self.assertEqual(stories.parse_grammar("〜は〜です — X is Y\n- 〜か\n"), [["〜は〜です", "X is Y"], ["〜か", ""]])

    def test_jlpt_comes_with_kotoba(self):
        jlpt = stories.syllabus(None, "jlpt")
        self.assertEqual([u["title"] for u in jlpt["units"]], ["N5", "N4", "N3", "N2", "N1"])
        n5 = jlpt["units"][0]
        self.assertIn(["会う", "あう", "to meet, to see"], n5["vocab"])
        self.assertTrue(n5["grammar"] and jlpt["units"][1]["grammar"])

    def test_list_entries_give_every_spelling(self):
        self.assertEqual(stories._forms(["足; 脚", "あし"]), (["足", "脚"], ["あし"]))
        self.assertEqual(stories._forms(["結婚", "けっこん (する)"]), (["結婚"], ["けっこん"]))
        self.assertEqual(stories._forms(["～円", "～えん"]), (["円"], ["えん"]))


class CheckTests(TestCase):
    units = [{"number": 1, "vocab": [["わたし", "", ""], ["会社員", "かいしゃいん", ""], ["さん", "", ""], ["行く", "いく", ""],
                                      ["会社", "かいしゃ", ""]], "grammar": []}]

    def problems(self, line):
        return [(p["surface"], p["reason"]) for p in stories.check([line], stories.allowed(self.units))]

    def test_studied_words_pass_and_new_ones_are_marked(self):
        self.assertEqual(self.problems("わたしは会社員です。"), [])
        self.assertEqual(self.problems("わたしは医者です。"), [("医者", "level")])

    def test_a_word_studied_in_kana_is_marked_when_written_in_kanji(self):
        self.assertEqual(self.problems("私は会社員です。"), [("私", "kanji")])
        self.assertEqual(self.problems("わたしはかいしゃいんです。"), [])
        self.assertEqual(self.problems("わたしは会しゃ員です。"), [])

    def test_a_listed_word_mecab_cuts_in_two_is_allowed_whole(self):
        units = [{"number": 1, "vocab": [["日本語", "にほんご", ""], ["本", "ほん", ""]], "grammar": []}]
        check = lambda line: [p["surface"] for p in stories.check([line], stories.allowed(units))]
        self.assertEqual(check("日本語の本"), [])
        self.assertEqual(check("英語の本"), ["英語"])

    def test_audio_is_compressed_when_ffmpeg_is_there(self):
        import shutil
        data, ext = stories._compress(tone(1.0))
        self.assertEqual(ext, ".m4a" if shutil.which("ffmpeg") else ".wav")
        self.assertLess(len(data), len(tone(1.0)) if ext == ".m4a" else len(data) + 1)

    def test_names_numbers_and_conjugations_are_allowed(self):
        self.assertEqual(self.problems("田中さんは三時に会社へ行きました。"), [])


class ReplyTests(TestCase):
    def test_the_story_is_read_out_of_the_reply(self):
        reply = '<think>hmm</think>```json\n{"title": "朝", "lines": [{"ja": "わたしは\\n会社員です。", "tr": "I am an employee."}, ' \
                '{"ja": ""}, "junk"], "grammar": [{"pattern": "〜は〜です", "lines": [1, 9]}]}\n```'
        story = stories.parse_story(reply)
        self.assertEqual(story["lines"], [{"ja": "わたしは 会社員です。", "tr": "I am an employee."}])
        self.assertEqual(story["grammar"], [{"pattern": "〜は〜です", "lines": [1]}])

    def test_an_answer_without_a_story_is_an_error(self):
        with self.assertRaises(stories.StoryError):
            stories.parse_story("Sorry, I can't.")

    def test_joined_audio_knows_where_each_line_is(self):
        audio, spans = stories._join([tone(0.5), tone(1.0)])
        self.assertEqual(spans, [(0.3, 0.8), (1.5, 2.5)])
        with wave.open(io.BytesIO(audio)) as w:
            self.assertAlmostEqual(w.getnframes() / w.getframerate(), 0.3 + 0.5 + stories.GAP + 1.0 + stories.GAP, places=2)


STORY = {"title": "会社", "title_tr": "The office", "lines": [
    {"ja": "わたしは会社員です。", "tr": "I am an office worker."},
    {"ja": "毎日医者に行きます。", "tr": "I go to the doctor every day."}],
    "grammar": [{"pattern": "〜は〜です", "lines": [1]}]}
FIX = {"lines": [{"n": 2, "ja": "毎日会社に行きます。", "tr": "I go to the office every day."}]}


@patch("speech.engine.tts", lambda text, voice, speed, readings=None: tone(0.4))
class StoryTests(SignedIn):
    def setUp(self):
        super().setUp()
        quiet = patch("library.words.kick")
        quiet.start()
        self.addCleanup(quiet.stop)
        self.syllabus = Syllabus.objects.create(owner=self.user, name="Minna no Nihongo")
        SyllabusUnit.objects.create(syllabus=self.syllabus, number=1, title="はじめまして",
                                    vocab=[["わたし", "", ""], ["会社員", "かいしゃいん", ""], ["会社", "", ""], ["行く", "", ""]],
                                    grammar=[["〜は〜です", "X is Y"]])
        SyllabusUnit.objects.create(syllabus=self.syllabus, number=2, vocab=[["毎日", "まいにち", "every day"]])

    def story(self, **req):
        r = self.client.post("/api/stories", {"syllabus": self.syllabus.id, "unit": 2, "voice": "kokoro:jf_alpha", **req},
                             content_type="application/json")
        return r

    def writer(self, *replies):
        return patch("library.translate._ask", side_effect=[json.dumps(x, ensure_ascii=False) for x in replies])

    def test_a_story_is_written_checked_fixed_and_voiced(self):
        with patch("library.stories.submit"), patch("library.translate.writer", return_value={"id": "x", "name": "Fake", "kind": "openai", "url": "http://127.0.0.1:1/v1", "model": "m", "key": ""}):
            r = self.story(theme="work")
            self.assertEqual(r.status_code, 201, r.content)
            with self.writer(STORY, FIX) as ask:
                stories.run(None, r.json()["id"])
        source = Source.objects.get(pk=r.json()["id"])
        prompt = ask.call_args_list[0].args[2]
        self.assertIn("毎日", prompt)
        self.assertIn("Words studied before: わたし、会社員、会社、行く", prompt)
        self.assertIn("Theme: work", prompt)
        self.assertIn("line 2: 医者", ask.call_args_list[1].args[2])
        self.assertEqual(source.kind, "story")
        self.assertEqual(source.title, "会社")
        self.assertEqual(source.story["state"], "done")
        self.assertEqual(source.story["repaired"], 1)
        self.assertEqual(source.story["outside"], [])
        rows = list(source.sentences.order_by("position"))
        self.assertEqual([s.text for s in rows], ["わたしは会社員です。", "毎日会社に行きます。"])
        self.assertEqual(rows[1].translations, {"en": "I go to the office every day."})
        self.assertEqual([(s.start, s.end) for s in rows], [(0.3, 0.7), (1.4, 1.8)])
        self.assertIn("story-", source.media.name)
        data = self.client.get(f"/api/sources/{source.id}").json()
        self.assertEqual(data["story"]["grammar"], [{"pattern": "〜は〜です", "lines": [1]}])

    def test_what_still_strays_is_kept_and_marked(self):
        with self.writer(STORY, {"lines": []}), patch("library.translate.writer", return_value={"id": "x", "name": "Fake", "kind": "openai", "url": "http://127.0.0.1:1/v1", "model": "m", "key": ""}):
            source = Source.objects.create(owner=self.user, kind="story", story={**stories._request(
                {"syllabus": self.syllabus.id, "unit": 2, "voice": "kokoro:jf_alpha"}, self.user)})
            stories.run(None, source.pk)
        source.refresh_from_db()
        second = source.sentences.get(position=1)
        self.assertEqual([(o["surface"], o["sentence"], o["reason"]) for o in source.story["outside"]], [("医者", second.pk, "level")])
        self.assertEqual(second.text[source.story["outside"][0]["start"]:source.story["outside"][0]["end"]], "医者")

    def test_a_failed_step_is_all_that_runs_again(self):
        source = Source.objects.create(owner=self.user, kind="story", story={**stories._request(
            {"syllabus": self.syllabus.id, "unit": 1, "voice": "nobody:here"}, self.user)})
        with self.writer(STORY, FIX), patch("library.translate.writer", return_value={"id": "x", "name": "Fake", "kind": "openai", "url": "http://127.0.0.1:1/v1", "model": "m", "key": ""}):
            with patch("speech.engine.tts", side_effect=ValueError("unknown voice")), self.assertRaises(stories.StoryError):
                stories.run(None, source.pk)
            source.refresh_from_db()
            self.assertEqual((source.story["state"], source.story["failed_at"]), ("failed", "voicing"))
            self.assertEqual(source.sentences.count(), 2)
            stories.run(None, source.pk)  # no more answers from the writer: it isn't asked again
        source.refresh_from_db()
        self.assertEqual(source.story["state"], "done")
        self.assertTrue(source.media)

    def test_a_story_left_half_written_by_a_restart_reads_as_failed(self):
        source = Source.objects.create(owner=self.user, kind="story", story={"state": "writing"})
        self.assertEqual(self.client.get(f"/api/sources/{source.id}").json()["story"]["state"], "failed")

    def test_no_writer_no_story(self):
        r = self.story()
        self.assertEqual(r.status_code, 400)
        self.assertIn("Add-ons", r.json()["error"])
        self.assertFalse(Source.objects.filter(kind="story").exists())

    def test_units_without_words_cant_have_a_story(self):
        empty = Syllabus.objects.create(owner=self.user, name="Empty")
        SyllabusUnit.objects.create(syllabus=empty, number=1)
        r = self.client.post("/api/stories", {"syllabus": empty.id, "unit": 1}, content_type="application/json")
        self.assertEqual(r.status_code, 400)


class SyllabusApiTests(SignedIn):
    def test_a_syllabus_is_filled_in_unit_by_unit_and_linked_to_its_lesson(self):
        s = self.client.post("/api/syllabi", {"name": " Minna  no Nihongo "}, content_type="application/json").json()
        self.assertEqual(s["name"], "Minna no Nihongo")
        lesson = Lesson.objects.create(owner=self.user, title="Lesson 1")
        r = self.client.put(f"/api/syllabi/{s['id']}/units/1", {"title": "はじめまして", "vocab": "わたし\n会社員 かいしゃいん — office worker",
                                                                  "grammar": "〜は〜です — X is Y", "lesson": lesson.id},
                            content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["vocab"], [["わたし", "", ""], ["会社員", "かいしゃいん", "office worker"]])
        listed = self.client.get("/api/syllabi").json()
        self.assertEqual([x["name"] for x in listed], ["JLPT", "Minna no Nihongo"])
        self.assertEqual(listed[1]["units"], [{"number": 1, "title": "はじめまして", "vocab": 2, "grammar": 1,
                                               "lesson": lesson.id, "lesson_title": "Lesson 1"}])
        self.assertEqual(self.client.get(f"/api/lessons/{lesson.id}").json()["units"],
                         [{"syllabus": s["id"], "syllabus_name": "Minna no Nihongo", "number": 1, "title": "はじめまして"}])

    def test_csv_goes_out_and_comes_back(self):
        s = Syllabus.objects.create(owner=self.user, name="MNN")
        SyllabusUnit.objects.create(syllabus=s, number=1, title="one", vocab=[["会社員", "かいしゃいん", "office worker, employee"]],
                                    grammar=[["〜は〜です", "X is Y"]])
        out = self.client.get(f"/api/syllabi/{s.id}/csv").content.decode("utf-8-sig")
        SyllabusUnit.objects.all().delete()
        r = self.client.post(f"/api/syllabi/{s.id}/csv", {"csv": out + "2,two,vocab,毎日,まいにち,every day\n"}, content_type="application/json")
        self.assertEqual(r.json()["imported"], 2)
        one = SyllabusUnit.objects.get(syllabus=s, number=1)
        self.assertEqual((one.title, one.vocab, one.grammar), ("one", [["会社員", "かいしゃいん", "office worker, employee"]], [["〜は〜です", "X is Y"]]))
        bad = self.client.post(f"/api/syllabi/{s.id}/csv", {"csv": "x,y,vocab,a"}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)

    def test_jlpt_and_other_peoples_syllabi_cant_be_changed(self):
        self.assertEqual(self.client.put("/api/syllabi/jlpt/units/1", {"title": "x"}, content_type="application/json").status_code, 404)
        from django.contrib.auth import get_user_model
        other = Syllabus.objects.create(owner=get_user_model().objects.create_user("other"), name="Theirs")
        self.assertEqual(self.client.get(f"/api/syllabi/{other.id}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/syllabi/{other.id}").status_code, 404)
