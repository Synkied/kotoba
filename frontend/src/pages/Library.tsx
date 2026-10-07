import { Copy, Check, Play, Tag } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Source, type SourceKind } from '../lib/api'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SourcePanel } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, SearchBox, Skeleton, clock, dayLabel, useAsync, usePref, useToast, useAction } from '../components/ui'

const KINDS: { id: SourceKind | ''; name: string }[] = [
  { id: '', name: 'All' }, { id: 'capture', name: 'Captures' }, { id: 'audio', name: 'Audio' },
  { id: 'video', name: 'Video' }, { id: 'subtitle', name: 'Subtitles' }, { id: 'text', name: 'Text' },
]

export default function LibraryPage() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<SourceKind | ''>('')
  const [category, setCategory] = useState('')
  const [label, setLabel] = useState('')
  const [furigana, setFurigana] = usePref('furigana', true)
  const [roman, setRoman] = usePref('roman', false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [labelDraft, setLabelDraft] = useState<string | null>(null)
  const labelAction = useAction()
  const toast = useToast()
  const [limit, setLimit] = useState(200)
  useEffect(() => { setSelected(new Set()); setLabelDraft(null); setLimit(200) }, [q, kind, category, label])
  const nav = useNavigate()
  const facets = useAsync(() => api.facets(), [])
  const { data, error, loading, reload } = useAsync(
    () => api.sources({ status: 'kept', q, kind: kind || undefined, limit, category, label }),
    [q, kind, category, label, limit])

  // identical captures show once, with a ×N count (as screen_ocr's history did)
  const groups = useMemo(() => {
    const seen = new Map<string, { s: Source; n: number }>()
    const order: { s: Source; n: number }[] = []
    for (const s of data?.results ?? []) {
      const key = s.kind === 'capture' ? 'c:' + s.text : 'id:' + s.id
      const g = seen.get(key)
      if (g) g.n++
      else { const ng = { s, n: 1 }; seen.set(key, ng); order.push(ng) }
    }
    const days: { key: string; items: { s: Source; n: number }[] }[] = []
    for (const g of order) {
      const key = new Date(g.s.created_at).toDateString()
      if (days.at(-1)?.key !== key) days.push({ key, items: [] })
      days.at(-1)!.items.push(g)
    }
    return days
  }, [data])

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectedSources = (data?.results ?? []).filter(s => s.sentences.some(x => selected.has(x.id)))
  const addLabel = async (e: React.FormEvent) => {
    e.preventDefault()
    await labelAction.run(async () => {
      const name = labelDraft?.trim()
      if (!name) return
      if (selectedSources.some(s => !s.labels.includes(name) && s.labels.length >= 3)) {
        throw new Error('A selected source already has three labels. Edit its labels before adding another.')
      }
      await api.bulk({ ids: selectedSources.map(s => s.id), add_label: name })
      toast({ text: `Added “${name}” to ${selectedSources.length} source${selectedSources.length === 1 ? '' : 's'}` })
      setLabelDraft(null)
      reload()
      facets.reload()
    })
  }
  const filtered = q || kind || category || label

  return (
    <>
      <header className="page-head">
        <h1>Library <span className="meta num">{data ? `${data.count} sources` : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Look up a sentence, label or reading" /></div>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        <div className="group">
          <span className="meta">Kind</span>
          <div className="chips">
            {KINDS.map((k) => <button key={k.id} className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.name}</button>)}
          </div>
        </div>
        <details className="filter-details" open={category || label ? true : undefined}>
          <summary>Labels and categories{category || label ? ' · filtered' : ''}</summary>
          <div className="btn-row">
            <label className="field"><span>Label</span><select className="select" value={label} onChange={(e) => setLabel(e.target.value)}><option value="">All labels</option>{facets.data?.labels.map(l => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}</select></label>
            <label className="field"><span>Category</span><select className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{facets.data?.categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}</select></label>
          </div>
        </details>
        <div className="group">
          <span className="meta">Show</span>
          <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" className="check" style={{ width: 14, height: 14 }} checked={furigana} onChange={(e) => setFurigana(e.target.checked)} />Furigana</label>
          <label className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" className="check" style={{ width: 14, height: 14 }} checked={roman} onChange={(e) => setRoman(e.target.checked)} />Romaji</label>
        </div>
        {filtered && <button className="btn small ghost" onClick={() => { setQ(''); setKind(''); setCategory(''); setLabel('') }}>Clear filters</button>}
      </div>

      {selected.size > 0 && (
        <div className="toolbar active" role="toolbar" aria-label="Selection">
          <span className="num" style={{ fontWeight: 700 }}>{selected.size} sentences selected</span>
          <DeckPicker small sentenceIds={() => [...selected]} onDone={() => { setSelected(new Set()); setLabelDraft(null) }} />
          <button className="btn small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }}
            onClick={() => nav('/practice?ids=' + [...selected].join(','))}><Play aria-hidden="true" />Practise these</button>
          <button className="btn small ghost" disabled={labelAction.busy} onClick={() => setLabelDraft('')}><Tag aria-hidden="true" />Add label</button>
          <span className="grow" />
          <button className="btn small ghost" disabled={labelAction.busy} onClick={() => { setSelected(new Set()); setLabelDraft(null) }}>Clear</button>
          {labelDraft !== null && <form className="bulk-label-form" onSubmit={addLabel}>
            <label className="field"><span>Label for {selectedSources.length} selected source{selectedSources.length === 1 ? '' : 's'}</span>
              <input className="input" autoFocus maxLength={40} value={labelDraft} disabled={labelAction.busy} onChange={e => setLabelDraft(e.target.value)} placeholder="e.g. lesson 18" /></label>
            <button className="btn small" disabled={labelAction.busy || !labelDraft.trim()}>{labelAction.busy ? 'Adding…' : 'Add label'}</button>
            <button type="button" className="btn small ghost" disabled={labelAction.busy} onClick={() => setLabelDraft(null)}>Cancel</button>
            <p className="meta">Labels apply to the whole source, including its other sentences. Existing labels are kept.</p>
            {labelAction.error != null && <ErrorNotice error={labelAction.error} />}
          </form>}
        </div>
      )}

      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !groups.length ? (
          <div className="empty">
            <h2>{filtered ? 'Nothing matches' : 'Your library is empty'}</h2>
            <p>{filtered ? 'Try fewer filters, or search by reading: “kyou” finds 今日.' : 'Sources you keep from the inbox live here, with every sentence and every attempt at saying it.'}</p>
            {!filtered && <Link className="btn primary" to="/inbox">Go to the inbox</Link>}
          </div>
        ) : groups.map((day) => {
          const { date, rel } = dayLabel(day.items[0].s.created_at)
          return (
            <section className="day" key={day.key} aria-label={date}>
              <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}</div>
              {day.items.map(({ s, n }) => <LibrarySource key={s.id} s={s} n={n} furigana={furigana} roman={roman} selected={selected} toggle={toggle} />)}
            </section>
          )
        })}
      {data && data.results.length < data.count && <button className="btn" disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sources'}</button>}
    </>
  )
}

function LibrarySource({ s, n, furigana, roman, selected, toggle }: {
  s: Source; n: number; furigana: boolean; roman: boolean; selected: Set<number>; toggle: (id: number) => void
}) {
  const shown = s.sentences.slice(0, 6)
  return (
    <article className="entry no-select" aria-label={s.title || s.sentences[0]?.text}>
      <Link to={`/sources/${s.id}`} aria-label="Open source">
        <SourcePanel kind={s.kind} image={s.image} start={s.sentences[0]?.start} end={s.sentences.at(-1)?.end} alt={s.text.slice(0, 80)} />
      </Link>
      <div className="body">
        {s.title && <h3><Link to={`/sources/${s.id}`} style={{ textDecoration: 'none' }}>{s.title}</Link></h3>}
        <div className="rows">
          {shown.map((x, i) => (
            <div className="row row-select" key={x.id} style={{ borderBottom: i === shown.length - 1 ? 0 : undefined }}>
              <input type="checkbox" className="check" checked={selected.has(x.id)} onChange={() => toggle(x.id)} aria-label={`Select ${x.text}`} />
              <SentenceText>
                <Furigana text={x.text} pairs={x.furigana} show={furigana} />
                {roman && x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
              </SentenceText>
              <div className="acts"><Link className="btn small ghost" to={`/sentences/${x.id}`}>Details</Link><Stamps stamps={x.stamps} max={3} /><CopyButton text={x.text} /></div>
            </div>
          ))}
        </div>
        {s.sentences.length > shown.length && <Link className="more-lines" to={`/sources/${s.id}`}>+ {s.sentences.length - shown.length} more sentences</Link>}
        <div className="info">
          {n > 1 && <span className="plate hollow num">×{n}</span>}
          {s.category && <span className="plate">{s.category}</span>}
          {s.labels.map((l) => <span key={l} className="chip">{l}</span>)}
          <span className="meta num">{clock(s.created_at)}</span>
        </div>
      </div>
      <div className="side">
        {s.sentences.length > 0 && <Link className="btn small" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise</Link>}
      </div>
    </article>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toast = useToast()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button className="btn small icon ghost" aria-label={done ? 'Copied' : 'Copy'} title="Copy"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1400); toast({ text: 'Copied' }) } catch { toast({ text: 'Couldn’t copy. Select the text and copy it manually, or open kotoba over HTTPS.' }) } }}>
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  )
}
