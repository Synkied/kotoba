from django.test import TestCase

from .models import LessonFolder, Note, Source


class NoteApiTests(TestCase):
    def test_create_edit_list_and_delete_markdown_note(self):
        response = self.client.post('/api/notes', {'title': '  Grammar  ', 'body': '## て-form\n\n- [ ] Review'}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        note_id = response.json()['id']
        self.assertEqual(response.json()['title'], 'Grammar')
        response = self.client.patch(f'/api/notes/{note_id}', {'body': '**覚える**'}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.get('/api/notes').json()[0]['body'], '**覚える**')
        self.assertEqual(Note.objects.get(pk=note_id).body, '**覚える**')
        self.assertEqual(self.client.delete(f'/api/notes/{note_id}').status_code, 204)
        self.assertEqual(self.client.get('/api/notes').json(), [])

    def test_blank_title_is_rejected(self):
        response = self.client.post('/api/notes', {'title': ' ', 'body': 'text'}, content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_folder_and_source_links_survive_folder_removal(self):
        parent = LessonFolder.objects.create(name='Japanese')
        folder = LessonFolder.objects.create(name='Chapter 1', parent=parent)
        source = Source.objects.create(kind='text', title='例文', text='日本語を勉強します。')
        response = self.client.post('/api/notes', {'title': 'Grammar', 'body': 'Study', 'folder': folder.id,
                                                   'source_ids': [source.id]}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        note_id = response.json()['id']
        self.assertEqual(response.json()['folder'], folder.id)
        self.assertEqual(response.json()['sources'], [{'id': source.id, 'title': '例文', 'kind': 'text'}])
        response = self.client.patch(f'/api/notes/{note_id}', {'source_ids': []}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sources'], [])
        self.client.patch(f'/api/notes/{note_id}', {'source_ids': [source.id]}, content_type='application/json')
        self.assertEqual(self.client.delete(f'/api/lesson-folders/{folder.id}').status_code, 204)
        self.assertEqual(self.client.get(f'/api/notes/{note_id}').json()['folder'], parent.id)
        self.assertEqual(Note.objects.get(pk=note_id).sources.count(), 1)

    def test_nonexistent_source_cannot_be_linked(self):
        note = Note.objects.create(title='Grammar')
        response = self.client.patch(f'/api/notes/{note.id}', {'source_ids': [999999]}, content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(note.sources.count(), 0)


class NoteMentionAndLessonTests(TestCase):
    def test_mentioned_sources_are_linked_and_stay_linked(self):
        a = Source.objects.create(kind='text', title='会話', text='こんにちは')
        b = Source.objects.create(kind='text', title='例文', text='日本語')
        body = f'See [@会話 \\[1\\]](/sources/{a.id}) and [@例文](/sources/{b.id}), not [plain](/sources/{b.id}) or [@gone](/sources/999999).'
        response = self.client.post('/api/notes', {'title': 'Grammar', 'body': body}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual({s['id'] for s in response.json()['sources']}, {a.id, b.id})
        response = self.client.patch(f"/api/notes/{response.json()['id']}", {'body': 'rewritten'}, content_type='application/json')
        self.assertEqual({s['id'] for s in response.json()['sources']}, {a.id, b.id})

    def test_notes_kept_with_a_lesson(self):
        from .models import Lesson
        lesson = Lesson.objects.create(title='Lesson 18')
        other = Note.objects.create(title='Elsewhere')
        response = self.client.post('/api/notes', {'title': 'て-form', 'body': '\n## Rules\nmore', 'lesson': lesson.id}, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['lesson_title'], 'Lesson 18')
        listed = self.client.get(f'/api/notes?lesson={lesson.id}').json()
        self.assertEqual([n['id'] for n in listed], [response.json()['id']])
        self.assertNotIn(other.id, [n['id'] for n in listed])
        self.assertEqual(self.client.get(f'/api/lessons/{lesson.id}').json()['linked_notes'],
                         [{'id': response.json()['id'], 'title': 'て-form', 'excerpt': '## Rules'}])
        self.assertEqual([l['id'] for l in self.client.get('/api/lessons?q=Rules').json()], [lesson.id])
        self.client.delete(f'/api/lessons/{lesson.id}')
        self.assertIsNone(Note.objects.get(pk=response.json()['id']).lesson)
