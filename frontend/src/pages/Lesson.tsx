import { AudioLines, Check, ChevronLeft, ChevronRight, ExternalLink, FileText, Folder, Image, Pencil, Pin, Play, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Lesson, type LessonFile } from '../lib/api'
import { useStats } from '../App'
import { ErrorNotice, Skeleton, useAction, useAsync, usePref, useToast } from '../components/ui'
import { lessonContents, useLessonActions } from './Lessons'
import { Listen, lessonTracks } from '../components/LessonListen'
import { fileSize, folderOptions, materialsIn } from '../lib/lessonTree'

export default function LessonPage() {
  const id = Number(useParams().id)
  return <LessonDetail key={id} id={id} />
}

function LessonDetail({ id }: { id: number }) {
  const { data: l, error, reload, set } = useAsync(() => api.lesson(id), [id])
  const folders = useAsync(() => api.lessonFolders(), [])
  const actions = useLessonActions(set)
  const edit = useAction()
  const nav = useNavigate()
  const toast = useToast()
  const { refresh } = useStats()
  const [name, setName] = useState<string | null>(null)
  // a transcript on its way: look again now and then until it's there
  const transcribing = !!l && [...l.files, ...l.sources].some(x => x.job === 'waiting' || x.job === 'running')
  useEffect(() => {
    if (!transcribing) return
    const t = setInterval(() => api.lesson(id).then(set, () => { /* the next look may work */ }), 5000)
    return () => clearInterval(t)
  }, [transcribing, id, set])
  if (error) return <ErrorNotice error={error} action={<button className="btn" onClick={reload}>Try again</button>} />
  if (!l) return <Skeleton rows={3} />

  const rename = (e: React.FormEvent) => {
    e.preventDefault()
    const to = name?.trim()
    if (!to || to === l.title) return setName(null)
    edit.run(async () => { set(await api.updateLesson(l.id, { title: to })); setName(null) })
  }
  const remove = () => {
    if (!window.confirm(`Delete “${l.title}” and its ${l.files.length === 1 ? 'file' : `${l.files.length} files`}? Linked sources stay in Sources; files from its folder stay in the folder. This can’t be undone.`)) return
    edit.run(async () => { await api.deleteLesson(l.id); refresh(); toast({ text: `Deleted “${l.title}”` }); nav(l.folder ? `/library?folder=${l.folder}` : '/library') })
  }
  const busy = actions.busy || edit.busy
  const tracks = lessonTracks(l)
  const pdfs = l.files.filter(f => f.kind === 'pdf')

  return (
    <>
      {(actions.error ?? edit.error) != null && <ErrorNotice error={actions.error ?? edit.error} />}
      <header className="page-head">
        <Link className="btn icon ghost" to={l.done_at && !l.pinned ? '/library?view=archive' : l.folder ? `/library?folder=${l.folder}` : '/library'} aria-label="Back to the library"><ChevronLeft aria-hidden="true" /></Link>
        {name === null ? <>
          <h1><button className="btn ghost lesson-title" title="Rename" disabled={busy} onClick={() => setName(l.title)}>{l.title}</button>
            <span className="meta num">{lessonContents(l)}</span>
            {l.done_at && <span className="plate hollow">Done {new Date(l.done_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span>}</h1>
          <span className="grow" />
          <button className="btn ghost" disabled={busy} onClick={() => setName(l.title)}><Pencil aria-hidden="true" />Rename</button>
        </> : <>
          <form className="btn-row lesson-rename" onSubmit={rename}>
            <label><span className="sr">Lesson title</span>
              <input className="input" autoFocus maxLength={200} value={name} disabled={edit.busy} onFocus={e => e.target.select()}
                onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Escape' && setName(null)} /></label>
            <button className="btn small primary" disabled={!name.trim() || edit.busy} aria-busy={edit.busy}>{edit.busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn small ghost" disabled={edit.busy} onClick={() => setName(null)}>Cancel</button>
          </form>
          <span className="grow" />
        </>}
        <button className="btn ghost" disabled={busy} onClick={remove}><Trash2 aria-hidden="true" />Delete</button>
        <button className="btn" aria-pressed={l.pinned} disabled={busy} onClick={() => actions.pin(l)}><Pin aria-hidden="true" />{l.pinned ? 'Pinned' : 'Pin'}</button>
        {l.done_at
          ? <button className="btn primary" disabled={busy} onClick={() => actions.again(l)}><RotateCcw aria-hidden="true" />Study again</button>
          : <button className="btn primary" disabled={busy} onClick={() => actions.done(l)}><Check aria-hidden="true" />Done</button>}
      </header>

      {folders.data && (folders.data.length > 0 || l.folder !== null) && <LessonFolderField l={l} options={folderOptions(folders.data)} busy={busy}
        onMove={to => edit.run(async () => set(await api.updateLesson(l.id, { folder: to })))} />}

      <div className={'lesson-desk' + (pdfs.length ? '' : ' no-sheet')}>
        {pdfs.length > 0 ? <Sheet pdfs={pdfs} />
          : tracks.length > 0 ? <Listen l={l} tracks={tracks} onChange={set} />
          : <div className="empty lesson-empty"><h2>Nothing to study yet</h2><p>Add the worksheet, the textbook pages or the recordings. A PDF opens here; recordings play beside it with their transcript.</p><AddFiles l={l} onChange={set} primary /></div>}
        <div className="lesson-side">
          {pdfs.length > 0 && tracks.length > 0 && <Listen l={l} tracks={tracks} onChange={set} />}
          <Drawer id="notes" title="Notes" meta={l.notes.split('\n').find(x => x.trim())} defaultOpen>
            <Notes l={l} onChange={set} />
          </Drawer>
          <Drawer id="sources" title="Sources" meta={l.sources.length ? String(l.sources.length) : undefined}>
            <Sources l={l} onChange={set} />
          </Drawer>
          <Drawer id="files" title="Files" meta={l.files.length ? String(l.files.length) : undefined}>
            <Files l={l} onChange={set} />
          </Drawer>
        </div>
      </div>
    </>
  )
}

/** Which folder the lesson is kept in; changing it moves the lesson to the end of that folder. */
function LessonFolderField({ l, options, busy, onMove }: { l: Lesson; options: { id: number; label: string }[]; busy: boolean; onMove: (to: number | null) => void }) {
  return (
    <p className="lesson-folder">
      <label className="folder-field"><Folder aria-hidden="true" />Folder
        <select className="select chip-select" disabled={busy} value={l.folder ?? ''} onChange={e => onMove(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None, top level</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select></label>
      {l.folder !== null && <Link className="meta" to={`/library?folder=${l.folder}`}>Open the folder</Link>}
    </p>
  )
}

/** A section of the side column that folds away; each remembers whether it was open. */
function Drawer({ id, title, meta, defaultOpen = false, children }: { id: string; title: string; meta?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = usePref(`lesson-drawer-${id}`, defaultOpen)
  return (
    <details className="drawer" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><ChevronRight aria-hidden="true" className="drawer-mark" /><h2>{title}</h2>{meta && <span className={'meta drawer-meta' + (/^\d+$/.test(meta) ? ' num' : ' preview')}>{meta}</span>}</summary>
      <div className="drawer-body">{children}</div>
    </details>
  )
}

/** The worksheet: as large as the page allows, the thing you read while you listen. */
function Sheet({ pdfs }: { pdfs: LessonFile[] }) {
  const [shown, setShown] = useState(pdfs[0].id)
  const pdf = pdfs.find(f => f.id === shown) ?? pdfs[0]
  return (
    <section className="lesson-sheet" aria-label="Worksheet">
      <div className="panel-head">
        {pdfs.length > 1
          ? <div className="tabs" role="group" aria-label="PDFs">{pdfs.map(f => <button key={f.id} type="button" aria-pressed={f.id === pdf.id} onClick={() => setShown(f.id)}>{f.name.replace(/\.pdf$/i, '')}</button>)}</div>
          : <h2 className="lesson-file-name">{pdf.name.replace(/\.pdf$/i, '')}</h2>}
        <span className="grow" />
        <a className="btn small icon ghost" href={pdf.url} target="_blank" rel="noreferrer" aria-label={`Open ${pdf.name} in a new tab`} title="Open in a new tab"><ExternalLink aria-hidden="true" /></a>
      </div>
      <iframe key={pdf.id} src={pdf.url} title={pdf.name} />
    </section>
  )
}

function AddFiles({ l, onChange, primary = false }: { l: Lesson; onChange: (l: Lesson) => void; primary?: boolean }) {
  const action = useAction()
  const input = useRef<HTMLInputElement>(null)
  const upload = (files: FileList | null) => {
    if (!files?.length) return
    action.run(async () => { onChange(await api.addLessonFiles(l.id, [...files])) })
    if (input.current) input.current.value = ''
  }
  return <>
    {action.error != null && <ErrorNotice error={action.error} />}
    <label className={'btn lesson-add-files' + (primary ? ' primary' : ' small')} aria-busy={action.busy}>
      <Upload aria-hidden="true" />{action.busy ? 'Adding…' : 'Add files'}
      <input ref={input} type="file" multiple className="sr" disabled={action.busy} accept="application/pdf,.pdf,audio/*,video/*,image/*,.txt,.md" onChange={e => upload(e.target.files)} />
    </label>
  </>
}

const kindIcon = { pdf: FileText, audio: AudioLines, video: AudioLines, image: Image, text: FileText }
const jobLabel = { waiting: 'Waiting to transcribe', running: 'Transcribing…', failed: 'Transcribing failed', '': 'Transcript' }

/** Every file kept with the lesson, to open, add or remove. */
function Files({ l, onChange }: { l: Lesson; onChange: (l: Lesson) => void }) {
  const action = useAction()
  const remove = (f: LessonFile) => {
    if (!window.confirm(f.material ? `Take “${f.name}” out of this lesson? It stays in its folder.`
      : `Remove “${f.name}” from this lesson? The file is deleted.${f.source ? ' Its transcript stays in Sources.' : ''}`)) return
    action.run(async () => { await api.removeLessonFile(l.id, f.id); onChange({ ...l, files: l.files.filter(x => x.id !== f.id) }) })
  }
  return <>
    {l.files.length > 0 && <ul className="lesson-file-list">{l.files.map(f => {
      const Icon = kindIcon[f.kind]
      return (
        <li key={f.id}>
          <div className="lesson-file-row">
            <Icon aria-hidden="true" className="lesson-file-icon" />
            <span className="lesson-file-name" lang="ja">{f.name}</span>
            {f.source && f.job !== null && <Link className={'lesson-file-job' + (f.job === 'failed' ? ' failed' : '')} to={`/sources/${f.source}`}>{jobLabel[f.job]}</Link>}
            <a className="btn small icon ghost" href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.name} in a new tab`} title="Open in a new tab"><ExternalLink aria-hidden="true" /></a>
            <button className="btn small icon ghost" disabled={action.busy} aria-label={`Remove ${f.name}`} title="Remove" onClick={() => remove(f)}><X aria-hidden="true" /></button>
          </div>
          {f.kind === 'image' && <img className="lesson-image" src={f.url} alt={f.name} loading="lazy" />}
        </li>
      )
    })}</ul>}
    {action.error != null && <ErrorNotice error={action.error} />}
    <div className="btn-row">
      <AddFiles l={l} onChange={onChange} />
      <FromFolder l={l} onChange={onChange} />
    </div>
  </>
}

/** Files kept in the lesson's folder, as they are, to link into the lesson: they stay in the folder. */
function FromFolder({ l, onChange }: { l: Lesson; onChange: (l: Lesson) => void }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<number[]>([])
  const action = useAction()
  const all = useAsync(() => open ? api.materials() : Promise.resolve(null), [open])
  const linked = new Set(l.files.map(f => f.material))
  const offered = materialsIn(all.data ?? [], l.folder).filter(m => !linked.has(m.id))
  const add = () => action.run(async () => { onChange(await api.linkLessonMaterials(l.id, chosen)); setChosen([]); setOpen(false) })
  if (!open) return <button className="btn small ghost" onClick={() => setOpen(true)}><Folder aria-hidden="true" />Add from the folder</button>
  return (
    <div className="lesson-pick">
      {all.error != null ? <ErrorNotice error={all.error} /> : !all.data ? <Skeleton rows={2} /> : !offered.length
        ? <p className="meta">{l.folder === null ? 'No other files at the top level of the library' : 'No other files in this lesson’s folder'} yet.</p>
        : <ul className="material-list">{offered.map(m => (
            <li key={m.id} className="material-row" data-selected={chosen.includes(m.id) || undefined}>
              <input type="checkbox" className="check" id={`link-${m.id}`} checked={chosen.includes(m.id)} disabled={action.busy}
                onChange={() => setChosen(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])} />
              <label className="material-main" htmlFor={`link-${m.id}`}><span className="material-name" lang="ja">{m.name}</span><span className="meta num">{fileSize(m.size)}</span></label>
            </li>
          ))}</ul>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <div className="btn-row">
        {offered.length > 0 && <button className="btn small primary" disabled={!chosen.length || action.busy} aria-busy={action.busy} onClick={add}>{chosen.length > 1 ? `Add ${chosen.length} files` : 'Add'}</button>}
        <button className="btn small ghost" disabled={action.busy} onClick={() => { setOpen(false); setChosen([]) }}>Cancel</button>
      </div>
    </div>
  )
}

function Notes({ l, onChange }: { l: Lesson; onChange: (l: Lesson) => void }) {
  const [draft, setDraft] = useState(l.notes)
  const action = useAction()
  const dirty = draft !== l.notes
  const save = () => action.run(async () => { onChange(await api.updateLesson(l.id, { notes: draft })) })
  return (
    <div className="lesson-notes">
      <textarea className="textarea" aria-label="Notes" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={() => dirty && save()} placeholder="What to do, page numbers, what you found hard…" />
      {action.error != null && <ErrorNotice error={action.error} action={<button className="btn small" onClick={save}>Try again</button>} />}
      {dirty && <div className="btn-row"><button className="btn small" disabled={action.busy} onClick={save}>{action.busy ? 'Saving…' : 'Save notes'}</button>
        <button className="btn small ghost" disabled={action.busy} onClick={() => setDraft(l.notes)}>Discard</button></div>}
    </div>
  )
}

/** Sources from the library studied with this lesson: what gets practised from it. */
function Sources({ l, onChange }: { l: Lesson; onChange: (l: Lesson) => void }) {
  const [q, setQ] = useState<string | null>(null)
  const action = useAction()
  const found = useAsync(() => q === null ? Promise.resolve(null) : api.sources({ q, limit: 8 }), [q])
  const link = (ids: number[]) => action.run(async () => { onChange(await api.updateLesson(l.id, { sources: ids })) })
  const linked = new Set(l.sources.map(s => s.id))
  return (
    <div className="lesson-sources">
      {!l.sources.length && q === null && <p className="meta">Link the dialogue you pasted, the recording you transcribed or the captures you took for this lesson, to practise them from here.</p>}
      <ul className="lesson-source-list">{l.sources.map(s => (
        <li key={s.id}>
          <Link to={`/sources/${s.id}`} lang="ja">{s.title}</Link>
          <span className="meta num">{s.sentences} sentence{s.sentences === 1 ? '' : 's'}{s.status === 'inbox' ? ' · in the inbox' : s.status === 'archived' ? ' · archived' : ''}</span>
          <span className="grow" />
          {s.sentences > 0 && <Link className="btn small" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise</Link>}
          <button className="btn small icon ghost" disabled={action.busy} aria-label={`Unlink ${s.title}`} title="Unlink" onClick={() => link(l.sources.filter(x => x.id !== s.id).map(x => x.id))}><X aria-hidden="true" /></button>
        </li>
      ))}</ul>
      {q !== null && (
        <div className="lesson-source-picker">
          <label className="field"><span>Find a source by title, text, label or reading</span>
            <input className="input" autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ(null)} placeholder="lesson 19" /></label>
          {found.error != null && <ErrorNotice error={found.error} />}
          <ul className="lesson-source-list">{(found.data?.results ?? []).filter(s => !linked.has(s.id)).map(s => (
            <li key={s.id}>
              <span lang="ja">{s.title || s.sentences[0]?.text || s.text.slice(0, 60) || 'Untitled'}</span>
              <span className="meta num">{s.sentences.length} sentence{s.sentences.length === 1 ? '' : 's'}</span>
              <span className="grow" />
              <button className="btn small" disabled={action.busy} onClick={() => link([...linked, s.id])}><Plus aria-hidden="true" />Link</button>
            </li>
          ))}</ul>
          {found.data && !found.data.results.some(s => !linked.has(s.id)) && <p className="meta">{q ? 'No other source matches.' : 'Every source is linked already.'}</p>}
          <button className="btn small ghost" onClick={() => setQ(null)}>Done linking</button>
        </div>
      )}
      {action.error != null && <ErrorNotice error={action.error} />}
      {q === null && <button className="btn small lesson-link" onClick={() => setQ('')}><Plus aria-hidden="true" />Link a source</button>}
    </div>
  )
}
