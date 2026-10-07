import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, RotateCcw, Upload, Pencil } from 'lucide-react'
import { api, type ListeningExercise, type ListeningAttempt } from '../lib/api'
import { ErrorNotice, Skeleton, useAction, useAsync } from '../components/ui'
import ListeningPackageImport from '../components/ListeningPackageImport'
import ListeningQuizEditor from '../components/ListeningQuizEditor'

function readDraft(exercise: ListeningExercise): Record<string, string> | null {
  try {
    const stored = localStorage.getItem(`kotoba.listening-draft.${exercise.id}.${exercise.revision}`) ?? (exercise.revision === 1 ? localStorage.getItem(`kotoba.listening-draft.${exercise.id}`) : null)
    const data: unknown = JSON.parse(stored ?? 'null')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const entries = Object.entries(data)
    if (!entries.every(([key, value]) => typeof value === 'string' && value.length <= 500 && exercise.questions.some(q => q.id === key && (!q.choices || q.choices.some(c => c.value === value))))) return null
    return data as Record<string, string>
  } catch { return null }
}

function ExerciseSession({ exercise, pdf, pageCount, onEdited, onSaved }: { exercise: ListeningExercise; pdf: string; pageCount: number; onEdited: (exercise: ListeningExercise) => void; onSaved: (attempt: ListeningAttempt) => void }) {
  const [draft] = useState(() => readDraft(exercise))
  const [responses, setResponses] = useState<Record<string, string>>(draft ?? exercise.latest_attempt?.responses ?? {})
  const [result, setResult] = useState<ListeningAttempt | null>(draft !== null ? null : exercise.latest_attempt)
  const [speed, setSpeed] = useState('1')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [editing, setEditing] = useState(!exercise.questions.length)
  const player = useRef<HTMLAudioElement>(null)
  const action = useAction()
  const complete = exercise.questions.length > 0 && exercise.questions.every(q => responses[q.id]?.trim())
  const answered = exercise.questions.filter(q => responses[q.id]?.trim()).length
  useEffect(() => {
    if (result) return
    try { localStorage.setItem(`kotoba.listening-draft.${exercise.id}.${exercise.revision}`, JSON.stringify(responses)) } catch { /* drafts are optional; submission is saved on the server */ }
  }, [responses, result, exercise.id, exercise.revision])
  useEffect(() => {
    const audio = player.current
    return () => { audio?.pause() }
  }, [])
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!complete || result) return
    action.run(async () => {
      const saved = await api.listeningAttempt(exercise.id, responses, exercise.revision)
      setResult(saved)
      try { localStorage.removeItem(`kotoba.listening-draft.${exercise.id}.${exercise.revision}`); localStorage.removeItem(`kotoba.listening-draft.${exercise.id}`) } catch { /* optional */ }
      onSaved(saved)
    })
  }
  const retry = () => {
    setResponses({}); setResult(null); action.clearError()
    if (player.current) { player.current.pause(); player.current.currentTime = 0 }
  }
  return (
    <section aria-labelledby="exercise-title">
      <h2 id="exercise-title" className="listening-title" lang="ja">{exercise.position}. {exercise.title}</h2>
      <p className="listening-instructions">{exercise.instructions}</p>
      <div className="listening-layout">
        <div className="listening-source">
          <div className="listening-player">
            <audio ref={player} controls preload="metadata" src={exercise.audio} aria-label={`Exercise ${exercise.position} recording`} onError={() => setMediaError('This recording could not be loaded. Reload the page or check the imported audio file.')} />
            <div className="btn-row">
              <button className="btn small" type="button" onClick={async () => {
                if (!player.current) return
                player.current.currentTime = 0
                try { await player.current.play(); setMediaError(null) } catch { setMediaError('Playback could not start. Try the audio player’s Play button.') }
              }}><RotateCcw aria-hidden="true" />Play from start</button>
              <label className="listening-speed">Speed <select className="input" aria-label="Playback speed" value={speed} onChange={e => {
                setSpeed(e.target.value)
                if (player.current) player.current.playbackRate = Number(e.target.value)
              }}>{['0.75', '1', '1.25'].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
            </div>
            {mediaError && <ErrorNotice error={mediaError} />}
          </div>
          {exercise.image && !imageError && <figure className="listening-figure">
            <img src={exercise.image} alt={exercise.image_alt} onError={() => setImageError(true)} />
            <figcaption>Pictures from your lesson worksheet</figcaption>
          </figure>}
          {imageError && <p role="alert">The worksheet image could not load. <a href={pdf} target="_blank" rel="noreferrer">Open the PDF instead</a>.</p>}
          {!exercise.image && exercise.worksheet_text && <pre className="listening-worksheet-text" lang="ja">{exercise.worksheet_text}</pre>}
          {!exercise.image && !exercise.worksheet_text && pageCount > 0 && <iframe className="listening-pdf" src={`${pdf}#page=${exercise.worksheet_page}`} title={`Worksheet page ${exercise.worksheet_page}`} />}
          {pageCount > 0 && <p><a href={`${pdf}#page=${exercise.worksheet_page}`} target="_blank" rel="noreferrer">Open worksheet page {exercise.worksheet_page}</a></p>}
          {exercise.example && <p className="listening-example"><strong>Example</strong> <span lang="ja">{exercise.example}</span></p>}
        </div>
        {editing ? <ListeningQuizEditor exercise={exercise} pageCount={pageCount} onSaved={updated => { setEditing(false); onEdited(updated) }} onCancel={() => setEditing(false)} /> : !exercise.questions.length ? <div className="listening-answers"><h3>No questions yet</h3><p>Add the worksheet’s questions to start this quiz.</p><button className="btn primary" onClick={() => setEditing(true)}>Add questions</button></div> : <form className="listening-answers" onSubmit={submit}>
          <div className="listening-answer-head"><h3>{result ? 'Your saved answers' : 'Your answers'}</h3><span className="meta">{answered} / {exercise.questions.length}</span><button className="btn small" type="button" disabled={action.busy} onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit quiz</button></div>
          {exercise.questions.map((question, index) => {
            const feedback = result?.feedback.find(f => f.id === question.id)
            return <fieldset key={question.id} className="listening-question" disabled={action.busy || !!result}>
              <legend><span className="meta num">{index + 1}.</span> <span lang="ja">{question.prompt}</span></legend>
              {question.choices ? <div className="listening-choices">{question.choices.map(choice => <label className={'listening-choice' + (responses[question.id] === choice.value ? ' selected' : '')} key={choice.value}>
                <input type="radio" name={`question-${question.id}`} value={choice.value} checked={responses[question.id] === choice.value} onChange={() => setResponses(prev => ({ ...prev, [question.id]: choice.value }))} required />
                <span lang="ja">{choice.label}</span>
              </label>)}</div> : <label><span className="sr">{question.prompt}</span><input className="input listening-text" lang="ja" value={responses[question.id] ?? ''} placeholder={question.placeholder} maxLength={500} required onChange={e => setResponses(prev => ({ ...prev, [question.id]: e.target.value }))} /></label>}
              {feedback?.correct != null && <p className={feedback.correct ? 'meta' : 'listening-miss'}>{feedback.correct ? 'Correct' : `Answer: ${feedback.answer}`}{feedback.explanation && ` · ${feedback.explanation}`}</p>}
            </fieldset>
          })}
          {action.error != null && <ErrorNotice error={action.error} />}
          {result ? <div className="listening-result" role="status">
            <strong>{result.score === null ? 'Answers saved for review' : `${result.score} / ${result.total} correct`}</strong>
            <p>{result.score === null ? 'Listen again and compare your answers with the worksheet or your lesson corrections. This exercise has no answer key yet.' : 'Listen again to revisit anything you missed.'}</p>
            <p className="meta">Saved {new Date(result.created_at).toLocaleString()}</p>
            <button className="btn" type="button" onClick={retry}><RotateCcw aria-hidden="true" />Try again</button>
          </div> : <div className="listening-submit">
            <button className="btn primary" type="submit" disabled={!complete || action.busy} aria-busy={action.busy}>{action.busy ? 'Saving…' : exercise.has_answer_key ? 'Check answers' : 'Save answers & review'}</button>
            <p className="meta">{exercise.has_answer_key ? 'Answers appear after you submit.' : 'Answer-and-review practice · no automatic marking.'}</p>
          </div>}
        </form>}
      </div>
    </section>
  )
}

export default function ListeningPage() {
  const { data, error, loading, reload, set } = useAsync(api.listening, [])
  const [params, setParams] = useSearchParams()
  const [importing, setImporting] = useState(params.get('import') === '1')
  const lesson = data?.find(l => String(l.id) === params.get('lesson')) ?? data?.[0]
  const exercise = lesson?.exercises.find(e => String(e.id) === params.get('exercise')) ?? lesson?.exercises[0]
  const selectExercise = (id: number) => { if (lesson) setParams({ lesson: String(lesson.id), exercise: String(id) }) }
  const index = lesson?.exercises.findIndex(e => e.id === exercise?.id) ?? 0
  return <>
    <header className="page-head"><h1>Listening</h1><span className="grow" /><button className="btn primary" onClick={() => setImporting(true)}><Upload aria-hidden="true" />Import package</button>{lesson && <a className="btn" href={lesson.pdf} target="_blank" rel="noreferrer"><FileText aria-hidden="true" />Open worksheet</a>}</header>
    {importing && <ListeningPackageImport onCancel={() => setImporting(false)} onImported={created => {
      set([...(data ?? []), created]); setParams({ lesson: String(created.id) }); setImporting(false); reload()
    }} />}
    {error ? <ErrorNotice error={error} action={<button className="btn" onClick={reload}>Try again</button>} /> : loading && !data ? <Skeleton /> : !lesson ? !importing && <div className="empty"><h2>No quiz packages yet</h2><p>Import a lesson’s PDF and audio together to build listening quizzes.</p><button className="btn primary" onClick={() => setImporting(true)}>Import PDF & audio</button><Link className="btn" to="/collect">Collect material</Link></div> : <>
      {data && data.length > 1 && <label className="listening-lesson-picker">Package <select className="input" value={lesson.id} onChange={e => setParams({ lesson: e.target.value })}>{data.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>}
      <div className="listening-lesson-head"><h2>{lesson.title}</h2><p className="meta">{lesson.description} · {lesson.exercises.filter(e => e.latest_attempt).length} / {lesson.exercises.length} exercises saved</p></div>
      <nav className="listening-exercise-nav" aria-label="Listening exercises">{lesson.exercises.map(e => <button className="btn" key={e.id} onClick={() => selectExercise(e.id)} aria-current={exercise?.id === e.id ? 'step' : undefined}>Exercise {e.position}<span className="meta">{e.latest_attempt ? 'Saved' : e.questions.length ? `${e.questions.length} answers` : 'Add questions'}</span></button>)}</nav>
      {exercise ? <ExerciseSession key={`${exercise.id}.${exercise.revision}`} exercise={exercise} pdf={lesson.pdf} pageCount={lesson.page_count} onEdited={updated => {
        if (data) set(data.map(l => l.id !== lesson.id ? l : { ...l, exercises: l.exercises.map(e => e.id === updated.id ? updated : e) }))
      }} onSaved={attempt => {
        if (!data) return
        set(data.map(l => l.id !== lesson.id ? l : { ...l, exercises: l.exercises.map(e => e.id !== exercise.id ? e : { ...e, latest_attempt: attempt, attempt_count: e.attempt_count + 1 }) }))
      }} /> : <p>No exercises have been imported for this lesson.</p>}
      {exercise && <div className="listening-step"><button className="btn" disabled={index === 0} onClick={() => selectExercise(lesson.exercises[index - 1].id)}><ArrowLeft aria-hidden="true" />Previous exercise</button><button className="btn" disabled={index === lesson.exercises.length - 1} onClick={() => selectExercise(lesson.exercises[index + 1].id)}>Next exercise<ArrowRight aria-hidden="true" /></button></div>}
    </>}
  </>
}
