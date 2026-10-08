import { Archive, AudioLines, Check, FileText, Image, Link2, Pin, Plus, RotateCcw, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Lesson } from '../lib/api'
import { useStats } from '../App'
import { ErrorNotice, SearchBox, Skeleton, dayLabel, useAction, useAsync, useToast } from '../components/ui'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What a lesson holds, in a few words: "PDF · 4 recordings · 2 sources". */
export function lessonContents(l: Lesson) {
  const count = (kind: string) => l.files.filter(f => f.kind === kind).length
  const parts = [
    count('pdf') && (count('pdf') === 1 ? 'PDF' : `${count('pdf')} PDFs`),
    count('audio') && plural(count('audio'), 'recording'),
    count('video') && plural(count('video'), 'video'),
    count('image') && plural(count('image'), 'image'),
    count('text') && plural(count('text'), 'text file'),
    l.sources.length && plural(l.sources.length, 'source'),
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing attached yet'
}

/** Done or not, pinned or not, with an Undo: the list pages and the lesson page share it. */
export function useLessonActions(onChange: (l: Lesson) => void) {
  const action = useAction()
  const toast = useToast()
  const { refresh } = useStats()
  const update = (l: Lesson, data: { done?: boolean; pinned?: boolean }, text: string, undo: { done?: boolean; pinned?: boolean }) =>
    action.run(async () => {
      onChange(await api.updateLesson(l.id, data))
      refresh()
      toast({ text, undo: async () => { onChange(await api.updateLesson(l.id, undo)); refresh() } })
    })
  return {
    ...action,
    done: (l: Lesson) => update(l, { done: true }, l.pinned ? `“${l.title}” is done. It stays pinned.` : `“${l.title}” is done and in the archive`, { done: false }),
    again: (l: Lesson) => update(l, { done: false }, `“${l.title}” is back in your lessons`, { done: true }),
    pin: (l: Lesson) => update(l, { pinned: !l.pinned }, l.pinned ? `Unpinned “${l.title}”` : `Pinned “${l.title}”`, { pinned: l.pinned }),
  }
}

export default function LessonsPage() {
  const [params, setParams] = useSearchParams()
  const archive = params.get('view') === 'archive'
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const { stats } = useStats()
  const { data, error, loading, reload, set } = useAsync(() => api.lessons(archive ? { state: 'done', q } : {}), [archive, q])
  const actions = useLessonActions((changed) => set((prev) => {
    // a lesson done here leaves the list (unless pinned); one taken out of the archive leaves it
    const stays = archive ? changed.done_at !== null : changed.done_at === null || changed.pinned
    const known = prev?.some(l => l.id === changed.id)
    if (!stays) return (prev ?? []).filter(l => l.id !== changed.id)
    return known ? prev!.map(l => l.id === changed.id ? changed : l) : [changed, ...(prev ?? [])]
  }))
  const lessons = data ?? []
  const pinned = archive ? [] : lessons.filter(l => l.pinned)
  const todo = archive ? [] : lessons.filter(l => !l.pinned)
  const days = useMemo(() => {
    const out: { key: string; items: Lesson[] }[] = []
    if (archive) for (const l of data ?? []) {
      const key = new Date(l.done_at!).toDateString()
      if (out.at(-1)?.key !== key) out.push({ key, items: [] })
      out.at(-1)!.items.push(l)
    }
    return out
  }, [archive, data])
  const show = (view: 'archive' | null) => { setQ(''); setParams(view ? { view } : {}, { replace: true }) }

  return (
    <>
      <header className="page-head">
        <h1>Lessons <span className="meta num">{stats ? `${stats.lessons} to study` : ''}</span></h1>
        <span className="grow" />
        <div className="tabs" role="group" aria-label="Show">
          <button type="button" aria-pressed={!archive} onClick={() => show(null)}>Current</button>
          <button type="button" aria-pressed={archive} onClick={() => show('archive')}><Archive aria-hidden="true" />Archive</button>
        </div>
        {!creating && <button className="btn primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New lesson</button>}
      </header>

      {creating && <NewLesson onCancel={() => setCreating(false)} />}
      {actions.error != null && <ErrorNotice error={actions.error} />}
      {archive && <div className="lessons-search"><SearchBox value={q} onChange={setQ} placeholder="Search done lessons by title, notes or file" /></div>}

      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        archive ? (
          !lessons.length ? (
            <div className="empty">
              <h2>{q ? 'Nothing matches' : 'The archive is empty'}</h2>
              <p>{q ? 'Try another word from the title, the notes or a file name.' : 'When you finish a lesson, choose “Done”. It leaves your current lessons and waits here, with its files and notes, for whenever you want to look back.'}</p>
            </div>
          ) : days.map(day => {
            const { date, rel } = dayLabel(day.items[0].done_at!)
            return (
              <section className="day" key={day.key} aria-label={`Done ${date}`}>
                <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}</div>
                <ul className="source-cards">{day.items.map(l => <LessonCard key={l.id} l={l} actions={actions} />)}</ul>
              </section>
            )
          })
        ) : !lessons.length ? (
          !creating && <div className="empty">
            <h2>Nothing to study</h2>
            <p>A lesson keeps what you study together: a worksheet PDF, its recordings, your notes, and the sources you practise from it. Mark it done when you’re finished and it moves to the archive. Pin the ones you always want at hand.</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New lesson</button>
              {stats?.lessons === 0 && <button className="btn" onClick={() => show('archive')}><Archive aria-hidden="true" />Open the archive</button>}
            </div>
          </div>
        ) : <>
          {pinned.length > 0 && (
            <section className="day" aria-labelledby="pinned-head">
              <div className="day-head"><span className="date" id="pinned-head"><Pin aria-hidden="true" className="inline-icon" />Pinned</span><span className="meta">Always here, done or not</span></div>
              <ul className="source-cards">{pinned.map(l => <LessonCard key={l.id} l={l} actions={actions} />)}</ul>
            </section>
          )}
          <section className="day" aria-labelledby="todo-head">
            <div className="day-head"><span className="date" id="todo-head">To study</span><span className="meta num">{todo.length || ''}</span></div>
            {todo.length ? <ul className="source-cards">{todo.map(l => <LessonCard key={l.id} l={l} actions={actions} />)}</ul>
              : <p className="meta">All caught up. New material goes here; finished lessons are in the archive.</p>}
          </section>
        </>}
    </>
  )
}

function LessonCard({ l, actions }: { l: Lesson; actions: ReturnType<typeof useLessonActions> }) {
  const Icon = l.files.some(f => f.kind === 'pdf') ? FileText : l.files.some(f => f.kind === 'audio') ? AudioLines : l.files.some(f => f.kind === 'image') ? Image : Link2
  const note = l.notes.split('\n').find(line => line.trim())
  const when = l.done_at ? `Done ${new Date(l.done_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : `Added ${new Date(l.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  return (
    <li className="source-card lesson-card" data-done={l.done_at ? true : undefined}>
      <div className="source-card-body">
        <h3><Link to={`/lessons/${l.id}`} className="source-card-link">{l.title}</Link></h3>
        <p className="meta source-card-meta num"><Icon aria-hidden="true" />{lessonContents(l)} · {when}</p>
        {note && <p className="source-card-line">{note}</p>}
      </div>
      <div className="source-card-foot">
        <button className="btn small ghost" aria-pressed={l.pinned} disabled={actions.busy} onClick={() => actions.pin(l)}>
          <Pin aria-hidden="true" />{l.pinned ? 'Pinned' : 'Pin'}
        </button>
        <span className="grow" />
        {l.done_at
          ? <button className="btn small" disabled={actions.busy} onClick={() => actions.again(l)}><RotateCcw aria-hidden="true" />Study again</button>
          : <button className="btn small" disabled={actions.busy} onClick={() => actions.done(l)}><Check aria-hidden="true" />Done</button>}
      </div>
    </li>
  )
}

/** A title and the files, dropped or chosen. The title defaults to the first file's name. */
export function NewLesson({ onCancel, initialFiles = [] }: { onCancel?: () => void; initialFiles?: File[] }) {
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState<File[]>(initialFiles)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const action = useAction()
  const nav = useNavigate()
  const { refresh } = useStats()
  const add = (list: FileList | null) => { if (list) setFiles(prev => [...prev, ...[...list].filter(f => !prev.some(p => p.name === f.name && p.size === f.size))]); if (input.current) input.current.value = '' }
  const create = (e: React.FormEvent) => {
    e.preventDefault()
    action.run(async () => {
      const lesson = await api.createLesson(title.trim(), files)
      refresh()
      nav(`/lessons/${lesson.id}`)
    })
  }
  const named = title.trim() || files[0]?.name.replace(/\.[^.]+$/, '')
  return (
    <form className="sheet new-lesson" onSubmit={create}>
      <h2><Plus aria-hidden="true" />New lesson</h2>
      <label className="field"><span>Title</span>
        <input className="input" autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder={files[0] ? files[0].name.replace(/\.[^.]+$/, '') : 'Minna no Nihongo, lesson 19'} /></label>
      <label className={'drop' + (over ? ' over' : '') + (action.busy ? ' disabled' : '')}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}>
        <Upload aria-hidden="true" />
        <b>Drop the lesson’s files here</b>
        <span className="meta" style={{ color: 'inherit' }}>PDFs, recordings, videos, pictures · or click to choose</span>
        <input ref={input} type="file" multiple disabled={action.busy} accept="application/pdf,.pdf,audio/*,video/*,image/*,.txt,.md" onChange={e => add(e.target.files)} />
      </label>
      {files.length > 0 && <ul className="lesson-files-pending">{files.map((f, i) => (
        <li key={f.name + i}><span>{f.name}</span><span className="meta num">{(f.size / 1048576).toFixed(1)} MB</span>
          <button type="button" className="btn small icon ghost" aria-label={`Remove ${f.name}`} disabled={action.busy} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><X aria-hidden="true" /></button></li>
      ))}</ul>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <div className="btn-row">
        <button className="btn primary" disabled={!named || action.busy} aria-busy={action.busy}>{action.busy ? 'Creating…' : 'Create lesson'}</button>
        {onCancel && <button type="button" className="btn ghost" disabled={action.busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}
