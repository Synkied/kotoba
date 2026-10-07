import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api, type ListeningExercise, type ListeningQuestion } from '../lib/api'
import { ErrorNotice, useAction } from './ui'

const questionId = () => crypto.randomUUID?.() ?? `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export default function ListeningQuizEditor({ exercise, pageCount, onSaved, onCancel }: { exercise: ListeningExercise; pageCount: number; onSaved: (exercise: ListeningExercise) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(exercise.title)
  const [instructions, setInstructions] = useState(exercise.instructions)
  const [page, setPage] = useState(exercise.worksheet_page)
  const [questions, setQuestions] = useState<ListeningQuestion[]>(() => structuredClone(exercise.questions))
  const action = useAction()
  const update = (id: string, changes: Partial<ListeningQuestion>) => setQuestions(previous => previous.map(q => q.id === id ? { ...q, ...changes } : q))
  const valid = title.trim() && questions.length > 0 && questions.every(q => q.prompt.trim() && (!q.choices || q.choices.length >= 2 && q.choices.every(c => c.label.trim())))
  return <form className="listening-editor" onSubmit={event => {
    event.preventDefault()
    if (valid) action.run(async () => onSaved(await api.editListeningExercise(exercise.id, { title, instructions, worksheet_page: page, questions, revision: exercise.revision })))
  }}>
    <h3>{exercise.questions.length ? 'Edit this quiz' : 'Add questions from the worksheet'}</h3>
    <p>Use the worksheet alongside this recording. Enter each question and choose how you want to answer it.</p>
    <fieldset disabled={action.busy} className="listening-editor-fields">
      <label className="field"><span>Quiz title</span><input className="input" value={title} maxLength={200} required onChange={e => setTitle(e.target.value)} /></label>
      <label className="field"><span>Instructions</span><textarea className="textarea" value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)} /></label>
      {pageCount > 0 && <label className="field"><span>Worksheet page</span><select className="input" value={page} onChange={e => setPage(Number(e.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option value={index + 1} key={index}>Page {index + 1}</option>)}</select></label>}
      {questions.map((q, index) => <fieldset className="listening-editor-question" key={q.id}>
        <legend>Question {index + 1}</legend>
        <label className="field"><span>Question {index + 1} prompt</span><input className="input" value={q.prompt} maxLength={500} required onChange={e => update(q.id, { prompt: e.target.value })} /></label>
        <label className="field"><span>Answer format</span><select className="input" value={q.choices ? 'choices' : 'text'} onChange={e => update(q.id, { choices: e.target.value === 'choices' ? [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] : undefined })}><option value="text">Written answer</option><option value="choices">Multiple choice</option></select></label>
        {q.choices && <div className="listening-editor-choices">{q.choices.map((choice, ci) => <div className="btn-row" key={choice.value}>
          <label className="field"><span>Choice {ci + 1}</span><input className="input" value={choice.label} maxLength={100} required onChange={e => update(q.id, { choices: q.choices!.map(c => c.value === choice.value ? { ...c, label: e.target.value } : c) })} /></label>
          <button className="btn icon" type="button" disabled={q.choices!.length <= 2} aria-label={`Remove choice ${ci + 1} from question ${index + 1}`} onClick={() => update(q.id, { choices: q.choices!.filter(c => c.value !== choice.value) })}><X aria-hidden="true" /></button>
        </div>)}<button className="btn small" type="button" disabled={q.choices.length >= 10} onClick={() => update(q.id, { choices: [...q.choices!, { value: questionId(), label: String.fromCharCode(65 + q.choices!.length) }] })}><Plus aria-hidden="true" />Add choice</button></div>}
        <button className="btn small" type="button" onClick={() => setQuestions(previous => previous.filter(item => item.id !== q.id))}>Remove question {index + 1}</button>
      </fieldset>)}
      <button className="btn" type="button" disabled={questions.length >= 50} onClick={() => setQuestions(previous => [...previous, { id: questionId(), prompt: '' }])}><Plus aria-hidden="true" />Add question</button>
    </fieldset>
    {exercise.attempt_count > 0 && <p className="meta">Changing questions starts a new version of this quiz. Earlier attempts stay saved.</p>}
    {action.error != null && <ErrorNotice error={action.error} />}
    <div className="btn-row"><button className="btn primary" disabled={!valid || action.busy} aria-busy={action.busy}>{action.busy ? 'Saving quiz…' : 'Save quiz'}</button><button className="btn" type="button" disabled={action.busy} onClick={onCancel}>Cancel</button></div>
  </form>
}
