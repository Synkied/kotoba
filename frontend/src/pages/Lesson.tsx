import { BookAudio, Check, Paperclip, ChevronRight, Ellipsis, ExternalLink, Folder, NotebookPen, Pencil, Pin, Play, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Lesson, type LessonFile, type Note } from '../lib/api'
import { useStats } from '../App'
import { ErrorNotice, Skeleton, useAction, useAsync, usePref, useToast } from '../components/ui'
import { LessonContents, useLessonActions } from './Lessons'
import { KindTile } from '../components/Kind'
import { fileDye, fileIcon, type Dye } from '../lib/dyes'
import { Menu, MenuItem, MenuRule } from '../components/Menu'
import { Listen, altKey, clockTime, lessonTracks, type ListenControl, type Moment } from '../components/LessonListen'
import { fileSize, folderOptions, folderPath, materialsIn } from '../lib/lessonTree'
import { Button, ButtonLink, ButtonRow, Checkbox, EmptyState, Field, Input, Plate, Select, buttonClass } from '../components/ds'
import { MentionTextarea, NoteMarkdown, caretPoint, quoteToken, type Mentionable } from '../components/NoteMarkdown'

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
  const [moving, setMoving] = useState(false)
  // the desk's proportions, as you left them: the worksheet's share of the width, the player's of the side
  const [sheetShare, setSheetShare] = usePref('lesson-sheet-share', 50)
  const [listenShare, setListenShare] = usePref('lesson-listen-share', 60)
  const [tab, setTab] = usePref<NotebookTab>('lesson-tab', 'notes')
  const control = useRef<ListenControl | null>(null)
  const notebook = useRef<NotesControl | null>(null)
  const onQuote = useCallback((m: Moment) => { setTab('notes'); notebook.current?.quote(m) }, [setTab])
  const onTime = useCallback((track: string, t: number) => control.current?.playAt(track, t), [])
  // a transcript on its way: look again now and then until it's there
  const transcribing = !!l && [...l.files, ...l.sources].some(x => x.job === 'waiting' || x.job === 'running')
  useEffect(() => {
    if (!transcribing) return
    const t = setInterval(() => api.lesson(id).then(set, () => { /* the next look may work */ }), 5000)
    return () => clearInterval(t)
  }, [transcribing, id, set])
  if (error) return <ErrorNotice error={error} action={<Button onClick={reload}>Try again</Button>} />
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
      {/* where it's kept: the way back, a step at a time */}
      <nav className="lesson-crumbs" aria-label="Where this lesson is kept">
        <ol>
          <li><Link to="/library">Library</Link></li>
          {l.done_at && !l.pinned && <li><ChevronRight aria-hidden="true" /><Link to="/library?view=archive">Archive</Link></li>}
          {folderPath(folders.data ?? [], l.folder).map(f => <li key={f.id}><ChevronRight aria-hidden="true" /><Link to={`/library?folder=${f.id}`}>{f.name}</Link></li>)}
        </ol>
      </nav>
      <header className="page-head lesson-head">
        <KindTile dye="lesson" size="large" />
        {name === null ? <>
          <div className="lesson-heading">
            <h1>{l.title}</h1>
            <p><LessonContents l={l} />
              {l.done_at && <Plate tone="hollow">Done {new Date(l.done_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</Plate>}</p>
          </div>
        </> : <>
          <form className="btn-row lesson-rename" onSubmit={rename}>
            <label><span className="sr">Lesson title</span>
              <Input autoFocus maxLength={200} value={name} disabled={edit.busy} onFocus={e => e.target.select()}
                onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Escape' && setName(null)} /></label>
            <Button variant="primary" size="small" disabled={!name.trim() || edit.busy} aria-busy={edit.busy}>{edit.busy ? 'Saving…' : 'Save'}</Button>
            <Button type="button" variant="ghost" size="small" disabled={edit.busy} onClick={() => setName(null)}>Cancel</Button>
          </form>
        </>}
        <div className="lesson-actions">
          {/* the syllabus unit studied here: a story with its words, and everything before it */}
          {l.units.slice(0, 1).map((u) => <ButtonLink key={u.syllabus} to={`/sources/stories?syllabus=${u.syllabus}&unit=${u.number}`}
            title={`A story with ${u.syllabus_name}'s words up to unit ${u.number}`}><BookAudio aria-hidden="true" />Make a story</ButtonLink>)}
          <Button variant="ghost" icon className="card-pin" aria-pressed={l.pinned} disabled={busy} onClick={() => actions.pin(l)}
            aria-label="Pin to the top of the library" title={l.pinned ? 'Pinned to the top of the library' : 'Pin to the top of the library'}><Pin aria-hidden="true" /></Button>
          {l.done_at
            ? <Button disabled={busy} onClick={() => actions.again(l)}><RotateCcw aria-hidden="true" />Study again</Button>
            : <Button variant="primary" disabled={busy} onClick={() => actions.done(l)} title="Finished with it: it moves to the archive"><Check aria-hidden="true" />Mark done</Button>}
          <Menu label="More for this lesson" variant="ghost" icon content={<Ellipsis aria-hidden="true" />}>
            <MenuItem disabled={busy} onClick={() => setName(l.title)}><Pencil aria-hidden="true" />Rename lesson</MenuItem>
            <MenuItem disabled={busy || !folders.data} onClick={() => setMoving(true)}><KindTile dye="folder" size="small" />Move to another folder</MenuItem>
            <MenuRule />
            <MenuItem disabled={busy} onClick={remove}><Trash2 aria-hidden="true" />Delete lesson</MenuItem>
          </Menu>
        </div>
      </header>

      {moving && folders.data && <LessonFolderField l={l} options={folderOptions(folders.data)} busy={busy} onClose={() => setMoving(false)}
        onMove={to => edit.run(async () => { set(await api.updateLesson(l.id, { folder: to })); setMoving(false) })} />}

      <div className="lesson-desk" style={{ '--sheet': `${sheetShare}fr`, '--side': `${100 - sheetShare}fr`, '--listen': `${listenShare}fr`, '--notebook': `${100 - listenShare}fr` } as CSSProperties}>
        {pdfs.length > 0 ? <Sheet pdfs={pdfs} />
          : tracks.length > 0 ? <Listen l={l} tracks={tracks} onChange={set} controlRef={control} onQuote={onQuote} />
          : <EmptyState className="lesson-empty"><h2>Nothing to study yet</h2><p>Add the worksheet, the textbook pages or the recordings. A PDF opens here; recordings play beside it with their transcript.</p><AddFiles l={l} onChange={set} primary /></EmptyState>}
        <Splitter label="Resize the worksheet and the side column" axis="x" value={sheetShare} initial={50} min={30} max={75} onChange={setSheetShare} />
        <div className={'lesson-side' + (pdfs.length > 0 && tracks.length > 0 ? ' split' : '')}>
          {pdfs.length > 0 && tracks.length > 0 && <>
            <Listen l={l} tracks={tracks} onChange={set} controlRef={control} onQuote={onQuote} />
            <Splitter label="Resize the transcript and the notebook" axis="y" value={listenShare} initial={60} min={20} max={80} onChange={setListenShare} />
          </>}
          <Notebook tab={tab} onTab={setTab} counts={{ notes: l.linked_notes.length, sources: l.sources.length, files: l.files.length }}>
            {{
              notes: <Notes l={l} onChange={set} controlRef={notebook} onTime={tracks.length ? onTime : undefined} named={tracks.length > 1} />,
              sources: <Sources l={l} onChange={set} />,
              files: <Files l={l} onChange={set} />,
            }}
          </Notebook>
        </div>
      </div>
    </>
  )
}

/** Which folder the lesson is kept in; changing it moves the lesson to the end of that folder. */
function LessonFolderField({ l, options, busy, onMove, onClose }: {
  l: Lesson; options: { id: number; label: string }[]; busy: boolean; onMove: (to: number | null) => void; onClose: () => void
}) {
  return (
    <div className="lesson-folder" role="group" aria-label="Move this lesson">
      <label className="folder-field"><Folder aria-hidden="true" />Move to
        <Select autoFocus className="chip-select" disabled={busy} value={l.folder ?? ''} onKeyDown={e => e.key === 'Escape' && onClose()}
          onChange={e => onMove(e.target.value ? Number(e.target.value) : null)}>
          <option value="">The top level</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select></label>
      <Button variant="ghost" size="small" onClick={onClose}>Cancel</Button>
    </div>
  )
}

/** A rule between two parts of the desk, dragged (or moved with the arrow keys) to share the room between them.
 *  `value` is the first part's share, in percent of the two together; a double click puts it back. */
function Splitter({ label, axis, value, initial, min, max, onChange }: {
  label: string; axis: 'x' | 'y'; value: number; initial: number; min: number; max: number; onChange: (v: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const put = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v))))
  // the share is measured between the far edges of the two parts on either side of the rule
  const share = (el: HTMLElement, at: number) => {
    const a = el.previousElementSibling!.getBoundingClientRect(), b = el.nextElementSibling!.getBoundingClientRect()
    const [from, to] = axis === 'x' ? [a.left, b.right] : [a.top, b.bottom]
    const rule = axis === 'x' ? el.offsetWidth : el.offsetHeight
    return (at - from - rule / 2) / (to - from - rule) * 100
  }
  return (
    <div className="splitter" data-axis={axis} data-dragging={dragging || undefined} role="separator" tabIndex={0}
      aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      title="Drag to resize · double-click to reset"
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true) }}
      onPointerMove={e => dragging && put(share(e.currentTarget, axis === 'x' ? e.clientX : e.clientY))}
      onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => put(initial)}
      onKeyDown={e => {
        const step = e.shiftKey ? 10 : 2
        const by = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step }[e.key]
        if (by !== undefined && (axis === 'x') === (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); put(value + by) }
        else if (e.key === 'Home') { e.preventDefault(); put(min) }
        else if (e.key === 'End') { e.preventDefault(); put(max) }
        else if (e.key === 'Enter') { e.preventDefault(); put(initial) }
      }}>
      <i aria-hidden="true" />
    </div>
  )
}

type NotebookTab = 'notes' | 'sources' | 'files'
const notebookTabs: [NotebookTab, string, Dye][] = [['notes', 'Notes', 'note'], ['sources', 'Sources', 'source'], ['files', 'Files', 'doc']]

/** The notebook under the player: the notes you write while you listen, with the lesson's sources and files a tab away.
 *  Every tab stays mounted, so a note half written keeps its place while you look something up. */
function Notebook({ tab, onTab, counts, children }: { tab: NotebookTab; onTab: (t: NotebookTab) => void; counts: Record<NotebookTab, number>; children: Record<NotebookTab, React.ReactNode> }) {
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (e: React.KeyboardEvent, i: number) => {
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: notebookTabs.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const k = (to + notebookTabs.length) % notebookTabs.length
    onTab(notebookTabs[k][0]); tabs.current[k]?.focus()
  }
  return (
    <section className="notebook" aria-label="Notebook">
      <div className="notebook-tabs" role="tablist" aria-label="Notebook">
        {notebookTabs.map(([k, name, dye], i) => (
          <button key={k} ref={el => { tabs.current[i] = el }} type="button" role="tab" id={`${id}-${k}`} aria-controls={`${id}-${k}-panel`} data-dye={dye}
            aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} onClick={() => onTab(k)} onKeyDown={e => move(e, i)}>
            <KindTile dye={dye} size="small" icon={k === 'files' ? Paperclip : undefined} />{name}{counts[k] > 0 && <span className="n num">{counts[k]}</span>}
          </button>
        ))}
      </div>
      {notebookTabs.map(([k]) => (
        <div key={k} className="notebook-page" role="tabpanel" id={`${id}-${k}-panel`} aria-labelledby={`${id}-${k}`} hidden={tab !== k} data-tab={k}>
          {children[k]}
        </div>
      ))}
    </section>
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
        <a className={buttonClass({ variant: 'ghost', size: 'small', icon: true })} href={pdf.url} target="_blank" rel="noreferrer" aria-label={`Open ${pdf.name} in a new tab`} title="Open in a new tab"><ExternalLink aria-hidden="true" /></a>
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
    <label className={buttonClass(primary ? { variant: 'primary' } : { size: 'small' }, 'lesson-add-files')} aria-busy={action.busy}>
      <Upload aria-hidden="true" />{action.busy ? 'Adding…' : 'Add files'}
      <input ref={input} type="file" multiple className="sr" disabled={action.busy} accept="application/pdf,.pdf,audio/*,video/*,image/*,.txt,.md" onChange={e => upload(e.target.files)} />
    </label>
  </>
}

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
      return (
        <li key={f.id}>
          <div className="lesson-file-row">
            <KindTile dye={fileDye(f.kind)} icon={fileIcon[f.kind]} size="small" />
            <span className="lesson-file-name" lang="ja">{f.name}</span>
            {f.source && f.job !== null && <Link className={'lesson-file-job' + (f.job === 'failed' ? ' failed' : '')} to={`/sources/${f.source}`}>{jobLabel[f.job]}</Link>}
            <a className={buttonClass({ variant: 'ghost', size: 'small', icon: true })} href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.name} in a new tab`} title="Open in a new tab"><ExternalLink aria-hidden="true" /></a>
            <Button variant="ghost" size="small" icon disabled={action.busy} aria-label={`Remove ${f.name}`} title="Remove" onClick={() => remove(f)}><X aria-hidden="true" /></Button>
          </div>
          {f.kind === 'image' && <img className="lesson-image" src={f.url} alt={f.name} loading="lazy" />}
        </li>
      )
    })}</ul>}
    {action.error != null && <ErrorNotice error={action.error} />}
    <ButtonRow>
      <AddFiles l={l} onChange={onChange} />
      <FromFolder l={l} onChange={onChange} />
    </ButtonRow>
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
  if (!open) return <Button variant="ghost" size="small" onClick={() => setOpen(true)}><Folder aria-hidden="true" />Add from the folder</Button>
  return (
    <div className="lesson-pick">
      {all.error != null ? <ErrorNotice error={all.error} /> : !all.data ? <Skeleton rows={2} /> : !offered.length
        ? <p className="meta">{l.folder === null ? 'No other files at the top level of the library' : 'No other files in this lesson’s folder'} yet.</p>
        : <ul className="material-list">{offered.map(m => (
            <li key={m.id} className="material-row" data-selected={chosen.includes(m.id) || undefined}>
              <Checkbox type="checkbox" id={`link-${m.id}`} checked={chosen.includes(m.id)} disabled={action.busy}
                onChange={() => setChosen(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])} />
              <label className="material-main" htmlFor={`link-${m.id}`}><span className="material-name" lang="ja">{m.name}</span><span className="meta num">{fileSize(m.size)}</span></label>
            </li>
          ))}</ul>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <ButtonRow>
        {offered.length > 0 && <Button variant="primary" size="small" disabled={!chosen.length || action.busy} aria-busy={action.busy} onClick={add}>{chosen.length > 1 ? `Add ${chosen.length} files` : 'Add'}</Button>}
        <Button variant="ghost" size="small" disabled={action.busy} onClick={() => { setOpen(false); setChosen([]) }}>Cancel</Button>
      </ButtonRow>
    </div>
  )
}

type NotesControl = { quote: (m: Moment) => void }

/** The Markdown notes written for this lesson, read as pages and written in place; @ points at a source,
 *  and a line quoted from the transcript keeps its time code, to play it again from the note. */
function Notes({ l, onChange, controlRef, onTime, named }: {
  l: Lesson; onChange: (l: Lesson | ((prev: Lesson) => Lesson)) => void
  controlRef: RefObject<NotesControl | null>; onTime?: (track: string, t: number) => void; named: boolean
}) {
  const notes = useAsync(() => api.notes({ lesson: l.id }), [l.id])
  const [editing, setEditing] = useState<number | null>(null)
  // a quote waiting for its note to open, or the open note's own way in
  const [inserting, setInserting] = useState<string | null>(null)
  const editor = useRef<((text: string) => void) | null>(null)
  const action = useAction()
  const setNotes = notes.set
  const summary = (n: Note) => ({ id: n.id, title: n.title, excerpt: n.body.split('\n').map(x => x.trim()).find(Boolean) ?? '' })
  const saved = useCallback((n: Note) => {
    setNotes(prev => prev.map(x => x.id === n.id ? n : x))
    onChange(prev => ({ ...prev, linked_notes: prev.linked_notes.map(x => x.id === n.id ? summary(n) : x) }))
  }, [setNotes, onChange])
  const write = (body = '') => action.run(async () => {
    const n = await api.createNote({ title: l.title, body, folder: l.folder, lesson: l.id })
    setNotes(prev => [...(prev ?? []), n])
    onChange(prev => ({ ...prev, linked_notes: [...prev.linked_notes, summary(n)] }))
    setEditing(n.id)
  })
  const remove = (n: Note) => {
    if (!window.confirm(`Delete “${n.title}”? This can’t be undone.`)) return
    action.run(async () => {
      await api.deleteNote(n.id)
      setNotes(prev => prev.filter(x => x.id !== n.id))
      onChange(prev => ({ ...prev, linked_notes: prev.linked_notes.filter(x => x.id !== n.id) }))
      setEditing(null)
    })
  }
  // a quoted line goes where you're writing; else into the last note, opened; else into a new one
  useEffect(() => {
    controlRef.current = {
      quote: m => {
        const text = quoteToken(m, clockTime(m.t), named)
        if (editing !== null && editor.current) return editor.current(text)
        const last = notes.data?.at(-1)
        if (last) { setInserting(text); setEditing(last.id) }
        else if (notes.data) write(text + '\n\n')
      },
    }
    return () => { controlRef.current = null }
  })
  const open = (n: Note) => (e: React.MouseEvent) => {
    // clicking the page you're reading starts writing it, unless you meant a link or were selecting words
    if (editing !== null || (e.target as Element).closest('a, button, input') || !window.getSelection()?.isCollapsed) return
    setEditing(n.id)
  }
  const near: Mentionable[] = l.sources.map(s => ({ id: s.id, title: s.title, kind: s.kind }))
  if (notes.error != null) return <ErrorNotice error={notes.error} action={<Button size="small" onClick={notes.reload}>Try again</Button>} />
  if (!notes.data) return <Skeleton rows={2} />
  return (
    <div className="lesson-notes">
      {!notes.data.length && <p className="meta lesson-notes-empty">Write down what you notice as you study: the grammar, the page numbers, what tripped you up. Type @ to point at one of the lesson’s sources{onTime ? <>, or quote the line being spoken with its button or {altKey} Q</> : ''}.</p>}
      {notes.data.map(n => editing === n.id
        ? <NoteEditor key={n.id} note={n} near={near} busy={action.busy} onSaved={saved} onClose={() => { setEditing(null); setInserting(null) }} onDelete={() => remove(n)}
            insertRef={editor} first={inserting} player={!!onTime} />
        : <article key={n.id} className="lesson-note">
            <header>
              <h3 lang="ja">{n.title}</h3>
              <Button variant="ghost" size="small" icon disabled={editing !== null || action.busy} aria-label={`Edit ${n.title}`} title="Edit" onClick={() => setEditing(n.id)}><Pencil aria-hidden="true" /></Button>
              <ButtonLink variant="ghost" size="small" icon to={`/notes?note=${n.id}`} aria-label={`Open ${n.title} in Notes`} title="Open in Notes"><NotebookPen aria-hidden="true" /></ButtonLink>
            </header>
            {n.body.trim()
              ? <div className="lesson-note-read" onClick={open(n)}><NoteMarkdown body={n.body} onTime={onTime} /></div>
              : <button type="button" className="lesson-note-blank meta" disabled={editing !== null} onClick={() => setEditing(n.id)}>Empty. Start writing</button>}
          </article>)}
      {action.error != null && <ErrorNotice error={action.error} />}
      {editing === null && <Button size="small" className="lesson-link" disabled={action.busy} aria-busy={action.busy} onClick={() => write()}><Plus aria-hidden="true" />{action.busy ? 'Creating…' : notes.data.length ? 'Another note' : 'Write a note'}</Button>}
    </div>
  )
}

/** Bring the caret into sight, a little above the bottom, in whatever scrolls: the notebook, or the page.
 *  `centre` also pulls it down from the top and settles it in the lower middle, for a quote just put in. */
function reveal(el: HTMLTextAreaElement, caret: number, centre = false) {
  const y = el.getBoundingClientRect().top + caretPoint(el, caret).top
  const box = el.closest<HTMLElement>('.notebook-page')
  const scrolls = box && box.scrollHeight > box.clientHeight
  const [top, bottom] = scrolls ? [box.getBoundingClientRect().top, box.getBoundingClientRect().bottom - 72] : [0, window.innerHeight - 96]
  const scroller = scrolls ? box : window
  if (centre) { if (y > bottom || y < top + 24) scroller.scrollBy({ top: y - (top + (bottom - top) * .6) }) }
  else if (y + 28 > bottom) scroller.scrollBy({ top: y + 28 - bottom })
}

/** One note, written in place: it saves itself as you type, and once more when you're done. */
function NoteEditor({ note, near, busy, onSaved, onClose, onDelete, insertRef, first, player }: {
  note: Note; near: Mentionable[]; busy: boolean; onSaved: (n: Note) => void; onClose: () => void; onDelete: () => void
  /** filled with a way to put a quoted line at the caret; `first` is one to add at the end as it opens */
  insertRef: RefObject<((text: string) => void) | null>; first: string | null; player: boolean
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [state, setState] = useState<'saved' | 'saving' | 'failed'>('saved')
  const [problem, setProblem] = useState('')
  const pending = useRef<{ title: string; body: string } | null>(null)
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))
  const timer = useRef<number | undefined>(undefined)
  const save = useCallback(() => {
    window.clearTimeout(timer.current)
    const data = pending.current
    if (!data) return chain.current
    pending.current = null
    setState('saving')
    chain.current = chain.current.then(() => api.updateNote(note.id, { title: data.title.trim() || 'Untitled', body: data.body })).then(n => {
      onSaved(n)
      if (!pending.current) setState('saved')
      return true
    }, e => {
      pending.current ??= data
      setState('failed'); setProblem((e as Error).message)
      return false
    })
    return chain.current
  }, [note.id, onSaved])
  useEffect(() => () => { void save() }, [save])
  const edit = (next: { title?: string; body?: string }) => {
    pending.current = { title: next.title ?? title, body: next.body ?? body }
    if (next.title !== undefined) setTitle(next.title)
    if (next.body !== undefined) setBody(next.body)
    setState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save() }, 700)
  }
  const done = async () => { if (await save()) onClose() }
  // a quote takes a line of its own, with a blank line after it for what you make of it
  const put = (text: string, at?: number) => {
    const el = area.current
    const was = pending.current?.body ?? body
    const i = at ?? el?.selectionEnd ?? was.length
    const before = was.slice(0, i), after = was.slice(i)
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const block = lead + text + '\n\n'
    edit({ body: before + block + after.replace(/^\n+/, '') })
    const caret = before.length + block.length
    window.requestAnimationFrame(() => {
      if (!el) return
      el.focus({ preventScroll: true }); el.setSelectionRange(caret, caret)
      reveal(el, caret, true)
    })
  }
  // the page grows with what you write, so the notebook scrolls rather than a box inside it
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      // measure with the field's room held open: letting the notebook shrink for that instant would
      // clamp its scroll and throw a long note back to the top as you type
      const box = el.parentElement!
      box.style.minHeight = `${box.offsetHeight}px`
      el.style.flex = 'none'; el.style.height = 'auto'
      const grew = el.scrollHeight + el.offsetHeight - el.clientHeight > el.offsetHeight
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
      el.style.flex = ''; box.style.minHeight = ''
      // a new line at the bottom stays above the sticky foot
      if (grew && document.activeElement === el) reveal(el, el.selectionEnd)
    }
    fit()
    // and again when the notebook gets wider or narrower, which rewraps the lines
    let width = el.clientWidth
    const watch = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit() } })
    watch.observe(el)
    return () => watch.disconnect()
  }, [body])
  useEffect(() => { insertRef.current = text => put(text) })
  useEffect(() => () => { insertRef.current = null }, [insertRef])
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (first) put(first, note.body.length)
  })
  return (
    <article className="lesson-note" data-editing>
      <label><span className="sr">Note title</span>
        <Input className="lesson-note-title" lang="ja" maxLength={200} value={title} onChange={e => edit({ title: e.target.value })} /></label>
      <MentionTextarea ref={area} className="textarea lesson-note-text" aria-label={`Markdown for ${title || 'this note'}`} spellCheck autoFocus lang="ja"
        value={body} near={near} onValueChange={next => edit({ body: next })}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); void done() } }}
        placeholder="## て-form&#10;- Page 12, exercise 3&#10;- Listen again to @…" />
      {state === 'failed' && <ErrorNotice error={new Error(`Couldn’t save: ${problem}`)} action={<Button size="small" onClick={() => { void save() }}>Try again</Button>} />}
      <div className="lesson-note-foot">
        <span className="meta" role="status">{state === 'saving' ? 'Saving…' : state === 'failed' ? 'Not saved' : <><Check aria-hidden="true" />Saved</>}</span>
        <span className="meta lesson-note-hint">Markdown · @ links a source{player && <> · {altKey} K play / pause · {altKey} J L lines · {altKey} Q quote</>}</span>
        <span className="grow" />
        <Button variant="ghost" size="small" icon disabled={busy} aria-label={`Delete ${title || 'this note'}`} title="Delete" onClick={onDelete}><Trash2 aria-hidden="true" /></Button>
        <Button size="small" onClick={() => { void done() }}>Done writing</Button>
      </div>
    </article>
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
          {s.sentences > 0 && <ButtonLink size="small" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise</ButtonLink>}
          <Button variant="ghost" size="small" icon disabled={action.busy} aria-label={`Unlink ${s.title}`} title="Unlink" onClick={() => link(l.sources.filter(x => x.id !== s.id).map(x => x.id))}><X aria-hidden="true" /></Button>
        </li>
      ))}</ul>
      {q !== null && (
        <div className="lesson-source-picker">
          <Field><span>Find a source by title, text, label or reading</span>
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ(null)} placeholder="lesson 19" /></Field>
          {found.error != null && <ErrorNotice error={found.error} />}
          <ul className="lesson-source-list">{(found.data?.results ?? []).filter(s => !linked.has(s.id)).map(s => (
            <li key={s.id}>
              <span lang="ja">{s.title || s.sentences[0]?.text || s.text.slice(0, 60) || 'Untitled'}</span>
              <span className="meta num">{s.sentences.length} sentence{s.sentences.length === 1 ? '' : 's'}</span>
              <span className="grow" />
              <Button size="small" disabled={action.busy} onClick={() => link([...linked, s.id])}><Plus aria-hidden="true" />Link</Button>
            </li>
          ))}</ul>
          {found.data && !found.data.results.some(s => !linked.has(s.id)) && <p className="meta">{q ? 'No other source matches.' : 'Every source is linked already.'}</p>}
          <Button variant="ghost" size="small" onClick={() => setQ(null)}>Done linking</Button>
        </div>
      )}
      {action.error != null && <ErrorNotice error={action.error} />}
      {q === null && <Button size="small" className="lesson-link" onClick={() => setQ('')}><Plus aria-hidden="true" />Link a source</Button>}
    </div>
  )
}
