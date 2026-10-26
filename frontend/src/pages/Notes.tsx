import { BookOpen, Bold, Check, ChevronLeft, Clock, Code2, Ellipsis, Folder, Heading2, Italic, Link2, List, ListChecks, MoveHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type LessonFolder, type Note, type Source } from '../lib/api'
import { folderOptions, folderPath } from '../lib/lessonTree'
import { Button, Select } from '../components/ds'
import { Menu, MenuItem, MenuRule } from '../components/Menu'
import { MentionTextarea, NoteMarkdown, plainText } from '../components/NoteMarkdown'
import { dayLabel, usePref } from '../components/ui'

/** read: the note as a page (a click starts writing); write: its Markdown; split: both side by side */
type View = 'read' | 'write' | 'split'
const VIEWS: { value: View; label: string }[] = [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }]
const same = (a: Note, b: Note) => a.title === b.title && a.body === b.body
/** Today, Yesterday, else the date without the year unless it's another year's */
const shortDay = (iso: string) => {
  const d = new Date(iso)
  return dayLabel(iso).rel || d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

export default function NotesPage() {
  const [params, setParams] = useSearchParams()
  const requestedId = Number(params.get('note')) || null
  const [initialRequestedId] = useState(requestedId)
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<LessonFolder[]>([])
  const [draft, setDraft] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sourceSearch, setSourceSearch] = useState('')
  const [sourceResults, setSourceResults] = useState<Source[]>([])
  const [sourceLoading, setSourceLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [stored, setView] = usePref<View>('notes.view', 'read')
  const view: View = VIEWS.some(v => v.value === stored) ? stored : 'read'
  const [sideOpen, setSideOpen] = usePref('notes.side', true)
  const [wide, setWide] = usePref('notes.wide', true)
  const picker = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const sourceToggle = useRef<HTMLButtonElement>(null)
  const latest = useRef<Note | null>(null)
  const saved = useRef<Note | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const activeId = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const switchingRef = useRef(false)
  const creatingRef = useRef(false)
  const updatingRef = useRef(false)
  const snapshots = useRef(new Map<number, Note>())

  useEffect(() => {
    let live = true
    api.notes().then(items => {
      if (!live) return
      setNotes(items)
      snapshots.current = new Map(items.map(item => [item.id, item]))
      const first = items.find(item => item.id === initialRequestedId) ?? items[0] ?? null
      setDraft(first); latest.current = first; saved.current = first; activeId.current = first?.id ?? null
    }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [initialRequestedId])

  useEffect(() => {
    api.lessonFolders().then(setFolders, e => setMetaError(`Couldn’t load folders: ${e.message}`))
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    let live = true
    api.sources({ q: sourceSearch, limit: 20 }).then(page => { if (live) { setSourceResults(page.results); setSourceLoading(false); setMetaError('') } },
      e => { if (live) { setSourceResults([]); setMetaError(`Couldn’t find sources: ${e.message}`); setSourceLoading(false) } })
    return () => { live = false }
  }, [pickerOpen, sourceSearch])

  const persist = useCallback((note: Note) => {
    if (saved.current?.id === note.id && same(saved.current, note)) return queue.current
    setSaving(true); setSaveError('')
    queue.current = queue.current.catch(() => {}).then(async () => {
      const result = await api.updateNote(note.id, { title: note.title.trim() || 'Untitled', body: note.body })
      snapshots.current.set(result.id, result)
      setNotes(items => [result, ...items.filter(item => item.id !== result.id)])
      if (activeId.current === note.id) {
        saved.current = result
        if (latest.current && latest.current.id === note.id && same(latest.current, note)) {
          latest.current = result
          setDraft(result)
        }
      }
    }).catch(e => { if (activeId.current === note.id) setSaveError(e.message); throw e })
      .finally(() => { if (activeId.current === note.id) setSaving(false) })
    return queue.current
  }, [])

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    const note = latest.current
    if (note && (!saved.current || !same(saved.current, note))) void persist(note).catch(() => {})
  }, [persist])

  const choose = useCallback(async (note: Note, updateUrl = true) => {
    // the open note, picked again from the list: on a phone that opens it over the list
    if (note.id === activeId.current) { if (updateUrl) setParams({ note: String(note.id) }); return }
    if (switchingRef.current || creatingRef.current || updatingRef.current) return
    switchingRef.current = true; setSwitching(true)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    try {
      await queue.current
      if (latest.current && saved.current && !same(latest.current, saved.current)) await persist(latest.current)
      const next = snapshots.current.get(note.id) ?? note
      setDraft(next); latest.current = next; saved.current = next; activeId.current = next.id; setSaveError('')
      setPickerOpen(false); setMetaError('')
      if (updateUrl) setParams({ note: String(next.id) })
    } catch (e) { setSaveError((e as Error).message) }
    finally { switchingRef.current = false; setSwitching(false) }
  }, [persist, setParams])
  useEffect(() => {
    if (requestedId && requestedId !== activeId.current) {
      const target = notes.find(note => note.id === requestedId)
      if (target) void choose(target, false)
    }
  }, [requestedId, notes, choose])

  const updateMeta = async (data: { folder?: number | null; source_ids?: number[] }) => {
    const note = latest.current
    if (!note || updatingRef.current || switchingRef.current || creatingRef.current) return
    updatingRef.current = true; setUpdating(true); setMetaError('')
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    try {
      await queue.current
      if (latest.current && saved.current && !same(latest.current, saved.current)) await persist(latest.current)
      const result = await api.updateNote(note.id, data)
      snapshots.current.set(result.id, result)
      setNotes(items => [result, ...items.filter(item => item.id !== result.id)])
      setDraft(result); latest.current = result; saved.current = result
    } catch (e) { setMetaError((e as Error).message) }
    finally { updatingRef.current = false; setUpdating(false) }
  }
  const togglePicker = () => {
    setPickerOpen(!pickerOpen)
    setSourceLoading(!pickerOpen)
    setSourceSearch('')
  }
  const change = (data: Partial<Pick<Note, 'title' | 'body'>>) => {
    if (!latest.current || switchingRef.current || creatingRef.current || updatingRef.current) return
    const next = { ...latest.current, ...data }
    latest.current = next; setDraft(next)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void persist(next).catch(() => {}) }, 700)
  }
  const create = async () => {
    if (creatingRef.current || switchingRef.current || updatingRef.current) return
    creatingRef.current = true
    setCreating(true); setError('')
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (latest.current && saved.current && !same(latest.current, saved.current)) await persist(latest.current)
      const note = await api.createNote({ title: 'Untitled', body: '', folder: draft?.folder ?? null })
      snapshots.current.set(note.id, note)
      setNotes(items => [note, ...items]); setDraft(note); latest.current = note; saved.current = note; activeId.current = note.id
      setParams({ note: String(note.id) })
      setPickerOpen(false); setMetaError('')
      if (view === 'read') setView('write')
      window.setTimeout(() => input.current?.focus(), 0)
    } catch (e) { setError((e as Error).message) }
    finally { creatingRef.current = false; setCreating(false) }
  }
  const remove = async () => {
    if (!draft || updatingRef.current || !window.confirm(`Delete “${draft.title || 'Untitled'}”? This cannot be undone.`)) return
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      await queue.current.catch(() => {})
      await api.deleteNote(draft.id)
      snapshots.current.delete(draft.id)
      const remaining = notes.filter(item => item.id !== draft.id)
      setNotes(remaining); const first = remaining[0] ?? null
      const next = first ? snapshots.current.get(first.id) ?? first : null
      setDraft(next); latest.current = next; saved.current = next; activeId.current = next?.id ?? null; setSaveError('')
      setPickerOpen(false); setMetaError('')
      setParams(next ? { note: String(next.id) } : {})
    } catch (e) { setSaveError((e as Error).message) }
  }
  const format = (before: string, after = before, placeholder = 'text') => {
    const el = input.current
    if (!el || !draft || switchingRef.current || creatingRef.current || updatingRef.current) return
    const start = el.selectionStart, end = el.selectionEnd
    const selection = draft.body.slice(start, end) || placeholder
    change({ body: draft.body.slice(0, start) + before + selection + after + draft.body.slice(end) })
    window.setTimeout(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + selection.length) }, 0)
  }
  const filtered = notes.filter(note => (note.title + ' ' + note.body).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const displayedSave = notes.find(note => note.id === draft?.id)
  const dirty = !!draft && (!displayedSave || !same(draft, displayedSave))
  const retrySave = () => { if (latest.current) void persist(latest.current).catch(() => {}) }
  const options = folderOptions(folders)
  const availableSources = sourceResults.filter(source => !draft?.sources.some(link => link.id === source.id))
  /** Show the Markdown and put the caret in it: at the end, or at the line about as far down as `at` (0–1). */
  const write = (to: View = 'write', at?: number) => {
    setView(to)
    window.setTimeout(() => {
      const el = input.current
      if (!el) return
      let caret = el.value.length
      if (at !== undefined) {
        const lines = el.value.split('\n'), line = Math.min(lines.length - 1, Math.floor(at * lines.length))
        caret = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + lines[line].length
      }
      el.focus({ preventScroll: at !== undefined }); el.setSelectionRange(caret, caret)
    }, 0)
  }
  // clicking the page starts writing where you clicked, roughly; a link, a time code or a checkbox
  // does its own thing, and so does selecting text to copy
  const clickToWrite = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a, button, input, label') || window.getSelection()?.toString()) return
    const box = e.currentTarget.getBoundingClientRect()
    write('write', Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)))
  }
  const crumbs = draft?.folder ? folderPath(folders, draft.folder) : []
  const phone = notes.length > 0 && !requestedId ? 'list' : 'note'
  const busy = switching || creating || updating

  // the Markdown grows with what's written, so the page scrolls rather than a box inside it
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    const fit = () => {
      // measured with its room held open, so a long note's scroll isn't thrown back to the top as you type
      const box = el.parentElement!
      box.style.minHeight = `${box.offsetHeight}px`
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
      box.style.minHeight = ''
    }
    fit()
    let width = el.clientWidth
    const watch = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit() } })
    watch.observe(el)
    return () => watch.disconnect()
  }, [draft?.body, draft?.id, view])

  // the source picker closes on a click anywhere else
  useEffect(() => {
    if (!pickerOpen) return
    const away = (e: PointerEvent) => { if (!picker.current?.contains(e.target as Node) && !sourceToggle.current?.contains(e.target as Node)) setPickerOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [pickerOpen])

  return <div className="notes-page" data-side={sideOpen ? 'open' : 'closed'} data-phone={phone}>
    <aside className="notes-side" aria-label="Your notes">
      <div className="notes-side-head">
        <h1>Notes{notes.length > 0 && <span className="meta num">{notes.length}</span>}</h1>
        <Button size="small" onClick={create} disabled={busy}><Plus aria-hidden="true" />New note</Button>
      </div>
      <label className="notes-search"><Search aria-hidden="true" /><span className="sr">Search notes</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note" /></label>
      {loading ? <p className="notes-list-empty">Loading notes…</p> : filtered.length ? <ul className="notes-items">{filtered.map(note => {
        const line = plainText(note.body).split('\n').find(Boolean)
        return <li key={note.id}><button type="button" disabled={busy} className="notes-item" aria-current={draft?.id === note.id ? 'page' : undefined} onClick={() => { void choose(note) }}>
          <span className="notes-item-title">{note.title || 'Untitled'}</span>
          <time className="num" dateTime={note.updated_at} title={new Date(note.updated_at).toLocaleString()}>{shortDay(note.updated_at)}</time>
          <span className="notes-item-line">{note.lesson_title ? <><BookOpen aria-hidden="true" /><span lang="ja">{note.lesson_title}</span>{line && ' · '}</> : null}{line || (note.lesson_title ? '' : 'Empty note')}</span>
        </button></li>
      })}</ul> : <p className="notes-list-empty">{query ? `No note matches “${query}”.` : 'Your notes will appear here.'}</p>}
    </aside>

    <section className="notes-doc" aria-label={draft ? `Note: ${draft.title || 'Untitled'}` : 'Note'}>
      <header className="notes-bar">
        <Button variant="ghost" size="small" icon className="notes-side-toggle" aria-label={sideOpen ? 'Hide the list of notes' : 'Show the list of notes'} title={sideOpen ? 'Hide the list' : 'Show the list'}
          aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)}>{sideOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}</Button>
        <button type="button" className="notes-back" onClick={() => setParams({})}><ChevronLeft aria-hidden="true" />Notes</button>
        {draft && <nav className="notes-crumbs" aria-label="Where this note is">
          <Link to="/library">Library</Link>
          {crumbs.map(f => <span key={f.id}><span aria-hidden="true">/</span><Link to={`/library?folder=${f.id}`}>{f.name}</Link></span>)}
          <span><span aria-hidden="true">/</span><strong>{draft.title || 'Untitled'}</strong></span>
        </nav>}
        <span className="grow" />
        {draft && <>
          <span className={'notes-save' + (saveError ? ' failed' : '')} role="status">{saveError ? 'Not saved' : saving || dirty ? 'Saving…' : <><Check aria-hidden="true" />Saved</>}</span>
          <div className="notes-view" role="group" aria-label="Show the note as">
            {VIEWS.map(v => <button key={v.value} type="button" data-view={v.value} aria-pressed={view === v.value} onClick={() => v.value === 'read' ? setView('read') : write(v.value)}>{v.label}</button>)}
          </div>
          <Menu label="More" content={<Ellipsis aria-hidden="true" />} variant="ghost" size="small" icon>
            <MenuItem onClick={() => setWide(!wide)}><MoveHorizontal aria-hidden="true" />{wide ? 'Narrow the page' : 'Use the full width'}</MenuItem>
            <MenuRule />
            <MenuItem onClick={() => { void remove() }} disabled={busy}><Trash2 aria-hidden="true" />Delete note</MenuItem>
          </Menu>
        </>}
      </header>

      <div className="notes-canvas">
        {draft ? <div className="notes-sheet" data-wide={wide || undefined} data-view={view}>
          {saveError && <div className="notes-error" role="alert">Couldn’t save this note: {saveError} <button type="button" onClick={retrySave}>Try again</button></div>}
          {metaError && <div className="notes-error" role="alert">{metaError}</div>}
          <input className="notes-title" aria-label="Note title" maxLength={200} value={draft.title} disabled={busy} placeholder="Untitled"
            onChange={e => change({ title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); write(view === 'read' ? 'write' : view, 0) } }} />

          <dl className="notes-props">
            <div><dt><Folder aria-hidden="true" />Folder</dt><dd>
              <Select className="notes-prop-select" aria-label="Library folder" value={draft.folder ?? ''} disabled={busy}
                onChange={e => { void updateMeta({ folder: e.target.value ? Number(e.target.value) : null }) }}>
                <option value="">Library, top level</option>
                {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </Select>
            </dd></div>
            {draft.lesson !== null && <div><dt><BookOpen aria-hidden="true" />Lesson</dt><dd><Link className="notes-lesson" to={`/lessons/${draft.lesson}`} lang="ja">{draft.lesson_title}</Link></dd></div>}
            <div><dt><Link2 aria-hidden="true" />Sources</dt><dd className="notes-sources">
              {draft.sources.map(source => <span className="notes-source" key={source.id}>
                <Link to={`/sources/${source.id}`} lang="ja">{source.title}</Link>
                <button type="button" aria-label={`Unlink ${source.title}`} title="Unlink" disabled={busy}
                  onClick={() => { void updateMeta({ source_ids: draft.sources.filter(item => item.id !== source.id).map(item => item.id) }) }}><X aria-hidden="true" /></button>
              </span>)}
              <button ref={sourceToggle} type="button" className="notes-add-source" aria-expanded={pickerOpen} aria-controls="notes-source-picker" disabled={busy} onClick={togglePicker}><Plus aria-hidden="true" />{draft.sources.length ? 'Link' : 'Link a source'}</button>
              {pickerOpen && <div id="notes-source-picker" className="notes-source-picker" ref={picker}>
                <label><Search aria-hidden="true" /><span className="sr">Find a source</span><input type="search" autoFocus value={sourceSearch} placeholder="Find a source by title or text" onChange={e => { setSourceSearch(e.target.value); setSourceLoading(true) }} onKeyDown={e => { if (e.key === 'Escape') { setPickerOpen(false); sourceToggle.current?.focus() } }} /></label>
                <div className="notes-source-results">
                  {sourceLoading ? <p className="meta">Finding sources…</p> : availableSources.length ? availableSources.map(source => <button key={source.id} type="button" disabled={updating} onClick={() => { void updateMeta({ source_ids: [...draft.sources.map(item => item.id), source.id] }) }}><span lang="ja">{source.title || source.text.trim().slice(0, 80) || `${source.kind} source`}</span><small>{source.kind}</small></button>) : <p className="meta">{sourceSearch ? 'No other source matches.' : 'No sources to link yet.'}</p>}
                </div>
              </div>}
            </dd></div>
            <div><dt><Clock aria-hidden="true" />Edited</dt><dd className="meta"><time dateTime={draft.updated_at} title={new Date(draft.updated_at).toLocaleString()}>{shortDay(draft.updated_at)}, {new Date(draft.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time></dd></div>
          </dl>

          {view !== 'read' && <div className="notes-toolbar">
            <div className="notes-format" role="group" aria-label="Markdown formatting">
              <button type="button" title="Heading" aria-label="Insert heading" onClick={() => format('## ', '', 'Heading')}><Heading2 aria-hidden="true" /></button>
              <button type="button" title="Bold" aria-label="Insert bold" onClick={() => format('**', '**')}><Bold aria-hidden="true" /></button>
              <button type="button" title="Italic" aria-label="Insert italic" onClick={() => format('*', '*')}><Italic aria-hidden="true" /></button>
              <button type="button" title="Bullet list" aria-label="Insert bullet list" onClick={() => format('- ', '', 'List item')}><List aria-hidden="true" /></button>
              <button type="button" title="Checklist" aria-label="Insert checklist" onClick={() => format('- [ ] ', '', 'Task')}><ListChecks aria-hidden="true" /></button>
              <button type="button" title="Code" aria-label="Insert inline code" onClick={() => format('`', '`')}><Code2 aria-hidden="true" /></button>
            </div>
            <span className="meta notes-hint">Markdown · @ links a source{view === 'write' && ' · Esc to read'}</span>
          </div>}

          <div className="notes-body">
            {view !== 'read' && <MentionTextarea ref={input} className="notes-text" aria-label="Markdown note" spellCheck disabled={busy} value={draft.body} near={draft.sources}
              onValueChange={body => change({ body })} onKeyDown={e => { if (e.key === 'Escape' && view === 'write') { e.preventDefault(); setView('read') } }}
              placeholder={'## て-form\n- Page 12, exercise 3\n- Listen again to @…'} />}
            {view !== 'write' && (draft.body.trim()
              ? <div className="notes-read" onClick={view === 'read' ? clickToWrite : undefined}><NoteMarkdown body={draft.body} /></div>
              : view === 'read' ? <button type="button" className="notes-start" onClick={() => write()}>Start writing…</button>
              : <p className="meta notes-read">The page appears here as you write.</p>)}
          </div>
        </div> : <div className="notes-blank">
          {error ? <div className="notes-error" role="alert">Couldn’t load your notes: {error} <button type="button" onClick={() => window.location.reload()}>Try again</button></div> : <>
            <h2>{loading ? 'Opening your notes…' : 'Make room for a thought'}</h2>
            {!loading && <><p>Keep ideas, vocabulary and study plans together. Write in Markdown, link the sources it's about, and read it back as a page.</p>
              <Button variant="primary" onClick={create} disabled={creating}><Plus aria-hidden="true" />New note</Button></>}
          </>}
        </div>}
      </div>
    </section>
  </div>
}
