import { ChevronLeft, Play, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Sentence } from '../lib/api'
import { DeckPicker } from '../components/DeckPicker'
import { Furigana } from '../components/Furigana'
import { SentenceText } from '../components/SentenceText'
import { fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { ErrorNotice, SearchBox, Skeleton, useAsync, usePref } from '../components/ui'

const KINDS = [
  { id: '', name: 'All' }, { id: 'audio,video', name: 'Transcribed' }, { id: 'capture', name: 'Captures' },
  { id: 'subtitle', name: 'Subtitles' }, { id: 'text', name: 'Text' },
]
const STATUSES = [{ id: '', name: 'All' }, { id: 'inbox', name: 'Inbox' }, { id: 'kept', name: 'Kept' }, { id: 'archived', name: 'Archived' }]
const PRACTICE = [{ id: '', name: 'All' }, { id: 'new', name: 'Not practised' }, { id: 'practised', name: 'Practised' }, { id: 'due', name: 'Due' }]
const FILTERS = ['q', 'kind', 'status', 'practice', 'label', 'category'] as const
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Every sentence from every source in one list, newest source first. Filters live in the
 *  URL, so coming back from a sentence keeps them. */
export default function SentencesPage() {
  const [params, setParams] = useSearchParams()
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<typeof FILTERS[number], string>
  const set = (key: typeof FILTERS[number], value: string) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (value) next.set(key, value); else next.delete(key)
    return next
  }, { replace: true })
  const [furigana] = usePref('furigana', true)
  const [limit, setLimit] = useState(100)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const key = FILTERS.map((k) => f[k]).join('\n')
  useEffect(() => { setSelected(new Set()); setLimit(100) }, [key])
  const nav = useNavigate()
  const facets = useAsync(() => api.facets(), [])
  const { data, error, loading, reload } = useAsync(() => api.sentences({ ...f, limit }), [key, limit])

  const items = data?.results ?? []
  const filtered = FILTERS.some((k) => f[k])
  const pick = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ids = items.filter((s) => selected.has(s.id)).map((s) => s.id)
  const allPicked = items.length > 0 && ids.length === items.length
  const labels = facets.data?.labels ?? []
  const categories = facets.data?.categories ?? []

  const chips = (title: string, name: 'kind' | 'status' | 'practice', options: { id: string; name: string }[]) => (
    <div className="group">
      <span className="meta">{title}</span>
      <div className="chips">
        {options.map((o) => <button key={o.id} className="chip" aria-pressed={f[name] === o.id} onClick={() => set(name, o.id)}>{o.name}</button>)}
      </div>
    </div>
  )

  return (
    <>
      <header className="page-head">
        <Link className="btn icon ghost" to="/transcriptions" aria-label="Transcription queue"><ChevronLeft aria-hidden="true" /></Link>
        <h1>All sentences <span className="meta num">{data ? plural(data.count, 'sentence') : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="Look up a sentence or reading" /></div>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        {chips('Kind', 'kind', KINDS)}
        {chips('Status', 'status', STATUSES)}
        {chips('Practice', 'practice', PRACTICE)}
        {labels.length > 0 && (
          <div className="group">
            <span className="meta">Label</span>
            <select className="select chip-select" aria-label="Label" value={f.label} onChange={(e) => set('label', e.target.value)}>
              <option value="">Any label</option>
              {labels.map((l) => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}
              {f.label && !labels.some((l) => l.name === f.label) && <option value={f.label}>{f.label}</option>}
            </select>
            {categories.length > 0 && <>
              <span className="meta">Category</span>
              <select className="select chip-select" aria-label="Category" value={f.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Any category</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                {f.category && !categories.some((c) => c.name === f.category) && <option value={f.category}>{f.category}</option>}
              </select>
            </>}
          </div>
        )}
        {filtered && <div className="group"><span className="grow" /><button className="btn small ghost" onClick={() => setParams({}, { replace: true })}><X aria-hidden="true" />Clear filters</button></div>}
      </div>

      {selected.size > 0 && (
        <div className="toolbar active selection-dock" role="toolbar" aria-label="Selection">
          <span className="num" style={{ fontWeight: 700 }}>{plural(ids.length, 'sentence')}</span>
          <DeckPicker small sentenceIds={() => ids} onDone={() => setSelected(new Set())} />
          <button className="btn small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }}
            onClick={() => nav('/practice?ids=' + ids.join(','))}><Play aria-hidden="true" />Practise these</button>
          <span className="grow" />
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !items.length ? (
          <div className="empty">
            <h2>{filtered ? 'Nothing matches' : 'No sentences yet'}</h2>
            <p>{filtered ? 'Try fewer filters, or search by reading: “kyou” finds 今日.' : 'Sentences appear here once audio is transcribed or text is collected.'}</p>
            {!filtered && <Link className="btn primary" to="/collect">Add audio or text</Link>}
          </div>
        ) : <>
          <label className="meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}>
            <input type="checkbox" className="check" checked={allPicked}
              onChange={() => setSelected(allPicked ? new Set() : new Set(items.map((s) => s.id)))} />
            Select all {items.length < (data?.count ?? 0) ? `${items.length} shown` : ''}
          </label>
          <ul className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((s) => <Row key={s.id} s={s} furigana={furigana} picked={selected.has(s.id)} onPick={() => pick(s.id)} />)}
          </ul>
        </>}
      {data && items.length < data.count && <button className="btn" disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sentences'}</button>}
    </>
  )
}

function Row({ s, furigana, picked, onPick }: { s: Sentence; furigana: boolean; picked: boolean; onPick: () => void }) {
  return (
    <li className="row row-select">
      <input type="checkbox" className="check" checked={picked} onChange={onPick} aria-label={`Select “${s.text}”`} />
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} /></SentenceText>
        <span className="meta"><Link to={`/sources/${s.source}`}>{s.source_title || 'Untitled'}</Link>
          {s.start != null && <> · <span className="num">{fmtTime(s.start)}</span></>}
          {s.decks.length > 0 && <> · {s.decks.map((d) => d.name).join(', ')}</>}</span>
      </div>
      <div className="acts">
        <Link className="btn small ghost" to={`/sentences/${s.id}`}>Details</Link>
        <Link className="btn small ghost" to={`/practice?ids=${s.id}`}><Play aria-hidden="true" />Practise</Link>
        <span className="record"><Stamps stamps={s.stamps} max={3} /></span>
      </div>
    </li>
  )
}
