import { Archive, Check, Pencil, Trash2, Loader, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Source } from '../lib/api'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SourcePanel } from '../components/SourcePanel'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, SearchBox, Skeleton, clock, dayLabel, useAsync, usePref, useToast, useAction, shortcutBlocked } from '../components/ui'
import { useStats } from '../App'

const SHOWN_LINES = 4

export default function InboxPage() {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)
  const action = useAction()
  const { data, error, loading, reload, set } = useAsync(() => api.sources({ status: 'inbox', q, limit }), [q, limit])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [furigana] = usePref('furigana', true)
  const toast = useToast()
  const { refresh } = useStats()
  const items = useMemo(() => data?.results ?? [], [data])

  useEffect(() => { setSelected(new Set()); setCursor(0); setLimit(200) }, [q])
  useEffect(() => { setCursor((c) => Math.max(0, Math.min(c, items.length - 1))) }, [items.length])

  const pending = items.some((s) => s.job === 'waiting' || s.job === 'running')
  useEffect(() => { if (!pending) return; const timer = window.setInterval(reload, 5000); return () => window.clearInterval(timer) }, [pending, reload])

  const days = useMemo(() => {
    const out: { key: string; items: Source[] }[] = []
    for (const s of items) {
      const key = new Date(s.created_at).toDateString()
      if (out.at(-1)?.key !== key) out.push({ key, items: [] })
      out.at(-1)!.items.push(s)
    }
    return out
  }, [items])

  const drop = useCallback((ids: number[]) => {
    if (data) set({ ...data, results: data.results.filter((s) => !ids.includes(s.id)), count: data.count - ids.length })
    setSelected(new Set())
    refresh()
  }, [data, set, refresh])

  const move = useCallback(async (ids: number[], status: 'kept' | 'archived') => {
    if (!ids.length) return
    await action.run(async () => {
    await api.bulk({ ids, status })
    drop(ids)
    toast({
      text: `${status === 'kept' ? 'Kept' : 'Archived'} ${ids.length > 1 ? ids.length + ' sources' : ''}`.trim(),
      undo: async () => { await api.bulk({ ids, status: 'inbox' }); reload(); refresh() },
    })
    })
  }, [drop, toast, reload, refresh, action])

  const remove = useCallback(async (ids: number[]) => {
    if (!ids.length || !window.confirm(`Delete ${ids.length > 1 ? ids.length + ' sources' : 'this source'} and its sentences? This can't be undone.`)) return
    await action.run(async () => { await api.bulk({ ids, delete: true }); drop(ids); toast({ text: 'Deleted' }) })
  }, [drop, toast, action])

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e) || editing !== null || action.busy) return
      const cur = items[cursor]
      const target = selected.size ? [...selected] : cur ? [cur.id] : []
      if (e.key === 'j') setCursor((c) => Math.max(0, Math.min(items.length - 1, c + 1)))
      else if (e.key === 'k') setCursor((c) => Math.max(0, c - 1))
      else if (e.key === 'x' && cur) toggle(cur.id)
      else if (e.key === 'Enter') move(target, 'kept')
      else if (e.key === 'a') move(target, 'archived')
      else if (e.key === 'e' && cur) setEditing(cur.id)
      else if (e.key === '#' || e.key === 'Delete') remove(target)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, cursor, selected, editing, move, remove, action.busy])
  useEffect(() => { document.querySelector('.entry.cursor')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  const ids = [...selected]
  const allChecked = items.length > 0 && items.every((s) => selected.has(s.id))

  return (
    <>
      <header className="page-head">
        <h1>Inbox <span className="meta num">{data ? `${data.count} to sort` : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Search the inbox (tokyo finds 東京)" /></div>
      </header>

      {action.error != null && <ErrorNotice error={action.error} />}
      <fieldset className="action-scope" disabled={action.busy} aria-busy={action.busy}>
      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !items.length ? (
          <div className="empty">
            <h2>{q ? 'Nothing matches' : 'Inbox zero'}</h2>
            <p>{q ? `No inbox items match “${q}”.` : 'Everything you collect lands here first: screen captures, recordings, subtitles and pasted text. Keep what you want to practise, archive the rest.'}</p>
            {q && <button className="btn" onClick={() => setQ('')}>Clear search</button>}
            {!q && <Link className="btn primary" to="/collect">Collect something</Link>}
          </div>
        ) : (
          <>
            <div className={'toolbar' + (selected.size ? ' active' : '')} role="toolbar" aria-label="Selection">
              <input type="checkbox" className="check" aria-label="Select all" checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allChecked }}
                onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((s) => s.id)))} />
              {selected.size ? (
                <>
                  <span className="num" style={{ fontWeight: 700 }}>{selected.size} selected</span>
                  <button className="btn small primary" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} onClick={() => move(ids, 'kept')}><Check aria-hidden="true" />Keep</button>
                  <button className="btn small ghost" onClick={() => move(ids, 'archived')}><Archive aria-hidden="true" />Archive</button>
                  <DeckPicker small sentenceIds={() => items.filter((s) => selected.has(s.id)).flatMap((s) => s.sentences.map((x) => x.id))} />
                  <LabelAdder ids={ids} onDone={reload} />
                  <span className="grow" />
                  <button className="btn small ghost" onClick={() => remove(ids)}><Trash2 aria-hidden="true" />Delete</button>
                </>
              ) : (
                <span className="hints" style={{ display: 'flex' }}>
                  <span><kbd className="kbd">j</kbd><kbd className="kbd">k</kbd> move</span>
                  <span><kbd className="kbd">x</kbd> select</span>
                  <span><kbd className="kbd">Enter</kbd> keep</span>
                  <span><kbd className="kbd">a</kbd> archive</span>
                  <span><kbd className="kbd">e</kbd> edit</span>
                </span>
              )}
            </div>

            {days.map((day) => {
              const { date, rel } = dayLabel(day.items[0].created_at)
              return (
                <section className="day" key={day.key} aria-label={date}>
                  <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}<span className="grow" style={{ flex: 1 }} /><span className="meta num">{day.items.length}</span></div>
                  {day.items.map((s) => {
                    const i = items.indexOf(s)
                    return (
                      <InboxEntry key={s.id} s={s} selected={selected.has(s.id)} cursor={i === cursor} furigana={furigana}
                        editing={editing === s.id} onEdit={(on) => setEditing(on ? s.id : null)}
                        onToggle={() => toggle(s.id)} onFocus={() => setCursor(i)}
                        onKeep={() => move([s.id], 'kept')} onArchive={() => move([s.id], 'archived')}
                        onSaved={(ns) => data && set({ ...data, results: data.results.map((x) => (x.id === ns.id ? ns : x)) })} />
                    )
                  })}
                </section>
              )
            })}
            {data && items.length < data.count && <button className="btn" disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sources'}</button>}
          </>
        )}
      </fieldset>
    </>
  )
}

function LabelAdder({ ids, onDone }: { ids: number[]; onDone: () => void }) {
  const [v, setV] = useState('')
  const action = useAction()
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (!v.trim()) return; await action.run(async () => { await api.bulk({ ids, add_label: v.trim() }); setV(''); onDone() }) }}
      style={{ display: 'flex', gap: 4 }}>
      <label><span className="sr">Add a label</span>
        <input className="input" style={{ height: 'var(--control-h-s)', minHeight: 0, width: '10rem' }} placeholder="Add label…" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <button className="btn small" disabled={!v.trim() || action.busy}>Add</button>
      {action.error != null && <ErrorNotice error={action.error} />}
    </form>
  )
}

function InboxEntry({ s, selected, cursor, furigana, editing, onEdit, onToggle, onFocus, onKeep, onArchive, onSaved }: {
  s: Source; selected: boolean; cursor: boolean; furigana: boolean; editing: boolean
  onEdit: (on: boolean) => void; onToggle: () => void; onFocus: () => void; onKeep: () => void; onArchive: () => void; onSaved: (s: Source) => void
}) {
  const [draft, setDraft] = useState(s.text)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const first = s.sentences[0]
  const label = s.title || first?.text || 'Untitled'
  const save = async () => {
    if (saving) return
    setSaving(true); setSaveError(null)
    try { onSaved(await api.updateSource(s.id, { text: draft })); onEdit(false) } catch (err) { setSaveError(err) } finally { setSaving(false) }
  }
  return (
    <article className={'entry' + (cursor ? ' cursor' : '')} data-selected={selected} onClick={onFocus} aria-label={label}>
      <input type="checkbox" className="check" checked={selected} onChange={onToggle} aria-label={`Select “${label}”`} />
      <Link to={`/sources/${s.id}`} aria-label={`Open ${label}`}>
        <SourcePanel kind={s.kind} image={s.image} start={first?.start} end={s.sentences.at(-1)?.end} alt={s.text.slice(0, 80)} />
      </Link>
      <div className="body">
        {s.title && <h3>{s.title}</h3>}
        {editing ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="field"><span>Text, one sentence per line</span>
              <textarea className="textarea" lang="ja" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && !saving) { setDraft(s.text); onEdit(false) }; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }} />
            </label>
            {saveError != null && <ErrorNotice error={saveError} />}
            <div className="btn-row">
              <button className="btn small primary" onClick={save} aria-busy={saving} disabled={saving}>Save</button>
              <button className="btn small ghost" disabled={saving} onClick={() => { setDraft(s.text); setSaveError(null); onEdit(false) }}>Cancel</button>
              <span className="meta">Fix OCR mistakes or split lines. <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">Enter</kbd> saves.</span>
            </div>
          </div>
        ) : s.job ? (
          <JobState s={s} />
        ) : s.sentences.length ? (
          <div className="lines">
            {s.sentences.slice(0, SHOWN_LINES).map(x => (
              <SentenceText key={x.id}><Furigana text={x.text} pairs={x.furigana} show={furigana} /></SentenceText>
            ))}
            {s.sentences.length > SHOWN_LINES && <Link className="more-lines" to={`/sources/${s.id}`}>+ {s.sentences.length - SHOWN_LINES} more sentences</Link>}
          </div>
        ) : <p className="meta">No text yet. Add it with Edit.</p>}
        <div className="info">
          {s.category && <span className="plate">{s.category}</span>}
          {s.labels.map((l) => <span key={l} className="chip">{l}</span>)}
          <span className="meta num">{clock(s.created_at)}</span>
          {s.sentences.length > 1 && <span className="meta num">{s.sentences.length} sentences</span>}
        </div>
      </div>
      <div className="side">
        <button className="btn small primary" onClick={onKeep}><Check aria-hidden="true" />Keep</button>
        <div className="btn-row">
          <button className="btn small icon ghost" onClick={() => onEdit(true)} aria-label="Edit text" title="Edit text (e)"><Pencil aria-hidden="true" /></button>
          <button className="btn small icon ghost" onClick={onArchive} aria-label="Archive" title="Archive (a)"><Archive aria-hidden="true" /></button>
        </div>
      </div>
    </article>
  )
}

function JobState({ s }: { s: Source }) {
  if (s.job === 'failed') return <div className="notice error" role="alert"><AlertTriangle aria-hidden="true" /><span>Transcription failed: {s.job_error} <Link to={`/recordings/${s.id}`}>Open recording to try again</Link></span></div>
  return (
    <div className="notice">
      <Loader aria-hidden="true" />
      <span>
        <b>{s.job === 'running' ? 'Transcribing now' : 'Waiting to be transcribed.'}</b>{' '}
        {s.job === 'waiting' && <>kotoba transcribes uploads automatically when Whisper is available. <Link to="/addons">Check transcription setup</Link>.</>}
      </span>
    </div>
  )
}
