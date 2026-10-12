import { Archive, Check, Pencil, Trash2, Loader, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Source } from '../lib/api'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SourcePanel } from '../components/SourcePanel'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, SearchBox, Skeleton, clock, dayLabel, useAsync, usePref, useToast, useAction, shortcutBlocked, PageHome } from '../components/ui'
import { useStats } from '../App'
import { Button, ButtonLink, ButtonRow, Checkbox, Chip, EmptyState, Field, Input, Kbd, Notice, Plate, Textarea } from '../components/ds'

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
        <h1><PageHome to="/inbox">Inbox</PageHome> <span className="meta num">{data ? `${data.count} to sort` : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Search the inbox (tokyo finds 東京)" /></div>
      </header>

      {action.error != null && <ErrorNotice error={action.error} />}
      <fieldset className="action-scope" disabled={action.busy} aria-busy={action.busy}>
      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        loading && !data ? <Skeleton /> :
        !items.length ? (
          <EmptyState>
            <h2>{q ? 'Nothing matches' : 'Inbox zero'}</h2>
            <p>{q ? `No inbox items match “${q}”.` : 'Everything you collect lands here first: screen captures, recordings, subtitles and pasted text. Keep what you want to practise, archive the rest.'}</p>
            {q && <Button onClick={() => setQ('')}>Clear search</Button>}
            {!q && <ButtonLink variant="primary" to="/collect">Collect something</ButtonLink>}
          </EmptyState>
        ) : (
          <>
            <div className={'toolbar' + (selected.size ? ' active' : '')} role="toolbar" aria-label="Selection">
              <Checkbox type="checkbox" aria-label="Select all" checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allChecked }}
                onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((s) => s.id)))} />
              {selected.size ? (
                <>
                  <span className="num" style={{ fontWeight: 700 }}>{selected.size} selected</span>
                  <Button variant="primary" size="small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} onClick={() => move(ids, 'kept')}><Check aria-hidden="true" />Keep</Button>
                  <Button variant="ghost" size="small" onClick={() => move(ids, 'archived')}><Archive aria-hidden="true" />Archive</Button>
                  <DeckPicker small sentenceIds={() => items.filter((s) => selected.has(s.id)).flatMap((s) => s.sentences.map((x) => x.id))} />
                  <LabelAdder ids={ids} onDone={reload} />
                  <span className="grow" />
                  <Button variant="ghost" size="small" onClick={() => remove(ids)}><Trash2 aria-hidden="true" />Delete</Button>
                </>
              ) : (
                <span className="hints" style={{ display: 'flex' }}>
                  <span><Kbd>j</Kbd><Kbd>k</Kbd> move</span>
                  <span><Kbd>x</Kbd> select</span>
                  <span><Kbd>Enter</Kbd> keep</span>
                  <span><Kbd>a</Kbd> archive</span>
                  <span><Kbd>e</Kbd> edit</span>
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
            {data && items.length < data.count && <Button disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sources'}</Button>}
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
        <Input style={{ height: 'var(--control-h-s)', minHeight: 0, width: '10rem' }} placeholder="Add label…" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <Button size="small" disabled={!v.trim() || action.busy}>Add</Button>
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
      <Checkbox type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select “${label}”`} />
      <Link to={`/sources/${s.id}`} aria-label={`Open ${label}`}>
        <SourcePanel kind={s.kind} image={s.image} start={first?.start} end={s.sentences.at(-1)?.end} alt={s.text.slice(0, 80)} />
      </Link>
      <div className="body">
        {s.title && <h3>{s.title}</h3>}
        {editing ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <Field><span>Text, one sentence per line</span>
              <Textarea lang="ja" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && !saving) { setDraft(s.text); onEdit(false) }; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }} />
            </Field>
            {saveError != null && <ErrorNotice error={saveError} />}
            <ButtonRow>
              <Button variant="primary" size="small" onClick={save} aria-busy={saving} disabled={saving}>Save</Button>
              <Button variant="ghost" size="small" disabled={saving} onClick={() => { setDraft(s.text); setSaveError(null); onEdit(false) }}>Cancel</Button>
              <span className="meta">Fix OCR mistakes or split lines. <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> saves.</span>
            </ButtonRow>
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
          {s.category && <Plate>{s.category}</Plate>}
          {s.labels.map((l) => <Chip key={l}>{l}</Chip>)}
          <span className="meta num">{clock(s.created_at)}</span>
          {s.sentences.length > 1 && <span className="meta num">{s.sentences.length} sentences</span>}
        </div>
      </div>
      <div className="side">
        <Button variant="primary" size="small" onClick={onKeep}><Check aria-hidden="true" />Keep</Button>
        <ButtonRow>
          <Button variant="ghost" size="small" icon onClick={() => onEdit(true)} aria-label="Edit text" title="Edit text (e)"><Pencil aria-hidden="true" /></Button>
          <Button variant="ghost" size="small" icon onClick={onArchive} aria-label="Archive" title="Archive (a)"><Archive aria-hidden="true" /></Button>
        </ButtonRow>
      </div>
    </article>
  )
}

function JobState({ s }: { s: Source }) {
  if (s.job === 'failed') return <Notice tone="error" role="alert"><AlertTriangle aria-hidden="true" /><span>Transcription failed: {s.job_error} <Link to={`/sources/${s.id}/cleanup`}>Open recording to try again</Link></span></Notice>
  return (
    <Notice>
      <Loader aria-hidden="true" />
      <span>
        <b>{s.job === 'running' ? 'Transcribing now' : 'Waiting to be transcribed.'}</b>{' '}
        {s.job === 'waiting' && <>kotoba transcribes uploads automatically when Whisper is available. <Link to="/addons">Check transcription setup</Link>.</>}
      </span>
    </Notice>
  )
}
