import { BookOpen, Bold, Check, Code2, Eye, Folder, Heading2, Italic, Link2, List, ListChecks, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type LessonFolder, type Note, type Source } from '../lib/api'
import { folderOptions } from '../lib/lessonTree'
import { Button, Select } from '../components/ds'
import { MentionTextarea, NoteMarkdown, plainText } from '../components/NoteMarkdown'

type View = 'split' | 'write' | 'preview'
const same = (a: Note, b: Note) => a.title === b.title && a.body === b.body

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
  const [view, setView] = useState<View>('split')
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
    if (note.id === activeId.current || switchingRef.current || creatingRef.current || updatingRef.current) return
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
      setView('write')
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

  return <div className="notes-page">
    <header className="page-head notes-head"><h1>Notes <span className="meta">A space to think through what you learn</span></h1><span className="grow" /><Button onClick={create} disabled={creating || switching || updating}><Plus size={16} /> New note</Button></header>
    {error && <div className="notes-error" role="alert">{error} <button type="button" onClick={() => window.location.reload()}>Try again</button></div>}
    <div className="notes-layout">
      <aside className="notes-list" aria-label="Your notes">
        <label className="notes-search"><Search size={16} aria-hidden="true" /><span className="sr">Search notes</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note" /></label>
        <div className="notes-list-heading"><strong>All notes</strong><span className="meta num">{notes.length}</span></div>
        {loading ? <p className="notes-list-empty">Loading notes…</p> : filtered.length ? <div className="notes-items">{filtered.map(note => <button key={note.id} type="button" disabled={switching || creating || updating} className="notes-item" aria-current={draft?.id === note.id ? 'page' : undefined} onClick={() => { void choose(note) }}><strong>{note.title || 'Untitled'}</strong><span>{plainText(note.body).split('\n').find(Boolean) || 'Empty note'}</span><small>{new Date(note.updated_at).toLocaleDateString()}</small></button>)}</div> : <p className="notes-list-empty">{query ? 'No notes match your search.' : 'Your notes will appear here.'}</p>}
      </aside>
      <section className="notes-workspace" aria-label="Note editor">
        {draft ? <>
          <div className="notes-document-head"><input className="notes-title" aria-label="Note title" maxLength={200} value={draft.title} disabled={switching || creating || updating} onChange={e => change({ title: e.target.value })} placeholder="Untitled" /><div className="notes-document-actions"><span className="notes-save" role="status">{saveError ? 'Not saved' : saving || dirty ? 'Saving…' : <><Check size={14} /> Saved</>}</span><button type="button" className="notes-delete" title="Delete note" aria-label="Delete note" disabled={switching || creating || updating} onClick={remove}><Trash2 size={17} /></button></div></div>
          {saveError && <div className="notes-error" role="alert">Couldn’t save this note: {saveError} <button type="button" onClick={retrySave}>Retry</button></div>}
          {metaError && <div className="notes-error" role="alert">{metaError}</div>}
          <div className="notes-context">
            <div className="notes-context-actions">
              <label className="notes-folder"><Folder size={15} aria-hidden="true" /><span className="sr">Library folder</span>
                <Select value={draft.folder ?? ''} disabled={updating || switching || creating} onChange={e => { void updateMeta({ folder: e.target.value ? Number(e.target.value) : null }) }}>
                  <option value="">Library top level</option>
                  {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </Select>
              </label>
              <button ref={sourceToggle} type="button" className="notes-add-source" aria-expanded={pickerOpen} aria-controls="notes-source-picker" disabled={updating || switching || creating} onClick={togglePicker}><Plus size={14} aria-hidden="true" />Link source</button>
            </div>
            {draft.lesson !== null && <Link className="notes-lesson" to={`/lessons/${draft.lesson}`}><BookOpen size={15} aria-hidden="true" />Written for <strong lang="ja">{draft.lesson_title}</strong></Link>}
            {draft.sources.length > 0 && <div className="notes-linked-sources" aria-label="Linked sources">
              {draft.sources.map(source => <span className="notes-source-link" key={source.id}>
                <Link to={`/sources/${source.id}`}><Link2 size={14} aria-hidden="true" />{source.title}</Link>
                <button type="button" aria-label={`Remove ${source.title} from this note`} title="Remove link" disabled={updating || switching || creating}
                  onClick={() => { void updateMeta({ source_ids: draft.sources.filter(item => item.id !== source.id).map(item => item.id) }) }}><X size={13} /></button>
              </span>)}
            </div>}
            {pickerOpen && <div id="notes-source-picker" className="notes-source-picker">
              <label><Search size={15} aria-hidden="true" /><span className="sr">Find a source</span><input type="search" autoFocus value={sourceSearch} placeholder="Find a source by title or text" onChange={e => { setSourceSearch(e.target.value); setSourceLoading(true) }} onKeyDown={e => { if (e.key === 'Escape') { setPickerOpen(false); sourceToggle.current?.focus() } }} /></label>
              <div className="notes-source-results">
                {sourceLoading ? <p className="meta">Finding sources…</p> : availableSources.length ? availableSources.map(source => <button key={source.id} type="button" disabled={updating} onClick={() => { void updateMeta({ source_ids: [...draft.sources.map(item => item.id), source.id] }) }}><span>{source.title || source.text.trim().slice(0, 80) || `${source.kind} source`}</span><small>{source.kind}</small></button>) : <p className="meta">{sourceSearch ? 'No other sources match.' : 'No sources to link yet.'}</p>}
              </div>
            </div>}
          </div>
          <div className="notes-toolbar">{view !== 'preview' && <div className="notes-format" aria-label="Markdown formatting"><button type="button" title="Heading" aria-label="Insert heading" onClick={() => format('## ', '', 'Heading')}><Heading2 size={18} /></button><button type="button" title="Bold" aria-label="Insert bold" onClick={() => format('**', '**')}><Bold size={18} /></button><button type="button" title="Italic" aria-label="Insert italic" onClick={() => format('*', '*')}><Italic size={18} /></button><button type="button" title="Bullet list" aria-label="Insert bullet list" onClick={() => format('- ', '', 'List item')}><List size={18} /></button><button type="button" title="Checklist" aria-label="Insert checklist" onClick={() => format('- [ ] ', '', 'Task')}><ListChecks size={18} /></button><button type="button" title="Code" aria-label="Insert inline code" onClick={() => format('`', '`')}><Code2 size={18} /></button></div>}<div className="notes-view" aria-label="Editor view"><button type="button" aria-pressed={view === 'write'} onClick={() => setView('write')}>Write</button><button type="button" aria-pressed={view === 'split'} onClick={() => setView('split')}>Split</button><button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}><Eye size={15} /> Preview</button></div></div>
          <div className={'notes-panes notes-panes-' + view}>{view !== 'preview' && <div className="notes-pane notes-write"><span className="notes-pane-label">MARKDOWN</span><MentionTextarea ref={input} aria-label="Markdown note" spellCheck disabled={switching || creating || updating} value={draft.body} near={draft.sources} onValueChange={body => change({ body })} placeholder="Start writing in Markdown…" /></div>}{view !== 'write' && <div className="notes-pane notes-preview"><span className="notes-pane-label">INTERPRETED</span><NoteMarkdown body={draft.body} empty="Your note will appear here as you write." /></div>}</div>
          <p className="notes-hint">Type @ to link a source. Use # for headings, - for lists, **bold**, and [text](url) for links. Changes save automatically.</p>
        </> : <div className="notes-blank"><h2>{loading ? 'Opening your notes…' : 'Make room for a thought'}</h2><p>Keep ideas, vocabulary, and study plans together. Write in Markdown and see the finished page as you go.</p>{!loading && <Button onClick={create} disabled={creating}><Plus size={16} /> Create your first note</Button>}</div>}
      </section>
    </div>
  </div>
}
