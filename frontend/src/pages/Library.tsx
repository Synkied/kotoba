import { Copy, Check, Play, Tag, X, AudioLines, Clapperboard, Captions, Type, Camera } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Source, type SourceKind } from '../lib/api'
import { DeckPicker } from '../components/DeckPicker'
import { fmtTime } from '../components/SourcePanel'
import { Stamp } from '../components/Stamp'
import { MAX_LABELS, mergeLabels, parseLabels } from '../lib/labels'
import { ErrorNotice, SearchBox, Skeleton, clock, dayLabel, useAsync, useToast, useAction } from '../components/ui'

const KINDS: { id: SourceKind | ''; name: string }[] = [
  { id: '', name: 'All' }, { id: 'capture', name: 'Captures' }, { id: 'audio', name: 'Audio' },
  { id: 'video', name: 'Video' }, { id: 'subtitle', name: 'Subtitles' }, { id: 'text', name: 'Text' },
]
const KIND = {
  capture: { name: 'Capture', Icon: Camera }, audio: { name: 'Audio', Icon: AudioLines }, video: { name: 'Video', Icon: Clapperboard },
  subtitle: { name: 'Subtitles', Icon: Captions }, text: { name: 'Text', Icon: Type },
} satisfies Record<SourceKind, unknown>
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function LibraryPage() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<SourceKind | ''>('')
  const [category, setCategory] = useState('')
  const [label, setLabel] = useState('')
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
  const clearSelection = () => { setSelected(new Set()); setLabelDraft(null) }
  const selectedSources = (data?.results ?? []).filter(s => selected.has(s.id))
  const sentenceIds = selectedSources.flatMap(s => s.sentences.map(x => x.id))
  const adding = parseLabels(labelDraft ?? '')
  const full = selectedSources.filter(s => mergeLabels(s.labels, adding) === null)
  const addLabels = async (e: React.FormEvent) => {
    e.preventDefault()
    await labelAction.run(async () => {
      if (!adding.length) return
      if (full.length) throw new Error(`${full.length === 1 ? 'A selected source' : `${full.length} selected sources`} would have more than ${MAX_LABELS} labels. Open ${full.length === 1 ? 'it' : 'them'} and remove a label first.`)
      await api.bulk({ ids: selectedSources.map(s => s.id), add_label: adding })
      const what = adding.length === 1 ? `“${adding[0]}”` : `${adding.length} labels`
      toast({ text: `Added ${what} to ${plural(selectedSources.length, 'source')}` })
      setLabelDraft(null)
      reload()
      facets.reload()
    })
  }
  const filtered = q || kind || category || label
  const filterLabel = (l: string) => setLabel(cur => cur === l ? '' : l)
  const filterCategory = (c: string) => setCategory(cur => cur === c ? '' : c)
  const labels = facets.data?.labels ?? []
  const categories = facets.data?.categories ?? []
  const shownLabels = labels.slice(0, 12)
  const moreLabels = labels.slice(12)

  return (
    <>
      <header className="page-head">
        <h1>Sources <span className="meta num">{data ? plural(data.count, 'source') : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Look up a sentence, label or reading" /></div>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        <div className="group">
          <span className="meta">Kind</span>
          <div className="chips">
            {KINDS.map((k) => <button key={k.id} className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.name}</button>)}
          </div>
          {filtered && <><span className="grow" /><button className="btn small ghost" onClick={() => { setQ(''); setKind(''); setCategory(''); setLabel('') }}><X aria-hidden="true" />Clear filters</button></>}
        </div>
        {labels.length > 0 && (
          <div className="group">
            <span className="meta">Labels</span>
            <div className="chips">
              {shownLabels.map(l => <button key={l.name} className="chip" aria-pressed={label === l.name} onClick={() => filterLabel(l.name)}>{l.name}<span className="n">{l.count}</span></button>)}
              {moreLabels.length > 0 && (
                <select className="select chip-select" aria-label="More labels" value={moreLabels.some(l => l.name === label) ? label : ''} onChange={(e) => setLabel(e.target.value)}>
                  <option value="">{moreLabels.length} more…</option>
                  {moreLabels.map(l => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}
                </select>
              )}
              {/* a label filtered from a card before the facets refresh still shows */}
              {label && !labels.some(l => l.name === label) && <button className="chip" aria-pressed onClick={() => setLabel('')}>{label}</button>}
            </div>
          </div>
        )}
        {categories.length > 0 && (
          <div className="group">
            <span className="meta">Category</span>
            <div className="chips">
              {categories.map(c => <button key={c.name} className="chip" aria-pressed={category === c.name} onClick={() => filterCategory(c.name)}>{c.name}<span className="n">{c.count}</span></button>)}
            </div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="toolbar active selection-dock" role="toolbar" aria-label="Selection">
          <span className="num" style={{ fontWeight: 700 }}>{plural(selected.size, 'source')} · {plural(sentenceIds.length, 'sentence')}</span>
          <DeckPicker small sentenceIds={() => sentenceIds} onDone={clearSelection} />
          <button className="btn small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} disabled={!sentenceIds.length}
            onClick={() => nav('/practice?ids=' + sentenceIds.join(','))}><Play aria-hidden="true" />Practise these</button>
          <button className="btn small ghost" disabled={labelAction.busy} aria-expanded={labelDraft !== null} onClick={() => setLabelDraft(d => d === null ? '' : null)}><Tag aria-hidden="true" />Add labels</button>
          <span className="grow" />
          <button className="btn small ghost" disabled={labelAction.busy} onClick={clearSelection}>Clear</button>
          {labelDraft !== null && <form className="bulk-label-form" onSubmit={addLabels} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLabelDraft(null) } }}>
            <label className="field"><span>Labels for {plural(selectedSources.length, 'source')}, separated by commas</span>
              <input className="input" autoFocus maxLength={130} list="library-labels" value={labelDraft} disabled={labelAction.busy}
                aria-invalid={full.length > 0 || undefined} aria-describedby="bulk-label-help"
                onChange={e => { setLabelDraft(e.target.value); labelAction.clearError() }} placeholder="minna no nihongo, lesson 18" /></label>
            <datalist id="library-labels">{labels.map(l => <option key={l.name} value={l.name} />)}</datalist>
            <button className="btn small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} disabled={labelAction.busy || !adding.length}>{labelAction.busy ? 'Adding…' : adding.length > 1 ? `Add ${adding.length} labels` : 'Add label'}</button>
            <button type="button" className="btn small ghost" disabled={labelAction.busy} onClick={() => setLabelDraft(null)}>Cancel</button>
            <div id="bulk-label-help" className="bulk-label-help">
              {adding.length > 0 && <div className="chips" aria-label="Labels to add">{adding.map(l => <span key={l} className="chip">{l}</span>)}</div>}
              <p className="meta">{full.length
                ? `${full.length === 1 ? 'One selected source already has' : `${full.length} selected sources already have`} too many labels for this. Up to ${MAX_LABELS} per source.`
                : `Existing labels are kept; up to ${MAX_LABELS} per source.`}</p>
            </div>
            {labelAction.error != null && <ErrorNotice error={labelAction.error} />}
          </form>}
        </div>
      )}

      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !groups.length ? (
          <div className="empty">
            <h2>{filtered ? 'Nothing matches' : 'No sources yet'}</h2>
            <p>{filtered ? 'Try fewer filters, or search by reading: “kyou” finds 今日.' : 'Sources you keep from the inbox live here, with every sentence and every attempt at saying it.'}</p>
            {!filtered && <Link className="btn primary" to="/inbox">Go to the inbox</Link>}
          </div>
        ) : groups.map((day) => {
          const { date, rel } = dayLabel(day.items[0].s.created_at)
          return (
            <section className="day" key={day.key} aria-label={date}>
              <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}</div>
              <ul className="source-cards">
                {day.items.map(({ s, n }) => <SourceCard key={s.id} s={s} n={n} q={q} selected={selected.has(s.id)} onToggle={() => toggle(s.id)}
                  label={label} category={category} onLabel={filterLabel} onCategory={filterCategory} />)}
              </ul>
            </section>
          )
        })}
      {data && data.results.length < data.count && <button className="btn" disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sources'}</button>}
    </>
  )
}

/** One source as a small card: what it is, a line of it, how far practice has got. The whole card opens the source. */
function SourceCard({ s, n, q, selected, onToggle, label, category, onLabel, onCategory }: {
  s: Source; n: number; q: string; selected: boolean; onToggle: () => void
  label: string; category: string; onLabel: (l: string) => void; onCategory: (c: string) => void
}) {
  const { name: kindName, Icon } = KIND[s.kind]
  const needle = q.trim()
  // when searching, show the line that matched rather than the first one
  const line = (needle && s.sentences.find(x => x.text.includes(needle))) || s.sentences[0]
  const title = s.title || line?.text || s.text.slice(0, 80) || 'Untitled'
  const excerpt = s.title ? line?.text : s.sentences[1]?.text
  const practised = s.sentences.filter(x => x.stamps.length).length
  const last = s.sentences.flatMap(x => x.stamps).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return (
    <li className="source-card" data-selected={selected || undefined}>
      {s.image && <img className="source-card-thumb" src={s.image} alt="" loading="lazy" />}
      <div className="source-card-body">
        <h3 lang={s.title ? undefined : 'ja'}><Link to={`/sources/${s.id}`} className="source-card-link">{title}</Link></h3>
        <p className="meta source-card-meta num">
          <Icon aria-hidden="true" />{kindName} · {plural(s.sentences.length, 'sentence')}
          {s.duration ? ` · ${fmtTime(s.duration).replace(/\.\d$/, '')}` : ''} · {clock(s.created_at)}
          {n > 1 && <span className="plate hollow num">×{n}</span>}
        </p>
        {excerpt && <p className="source-card-line" lang="ja">{excerpt}</p>}
        {(s.category || s.labels.length > 0) && (
          <div className="chips source-card-tags">
            {s.category && <button className="plate plate-filter" aria-pressed={category === s.category} title={`Show only “${s.category}”`} onClick={() => onCategory(s.category)}>{s.category}</button>}
            {s.labels.map((l) => <button key={l} className="chip" aria-pressed={label === l} title={label === l ? 'Show all labels' : `Show only “${l}”`} onClick={() => onLabel(l)}>{l}</button>)}
          </div>
        )}
      </div>
      <div className="source-card-foot">
        {last && <Stamp s={last} />}
        <span className="meta num">{s.sentences.length === 0 ? 'No sentences yet' : practised === 0 ? 'Not practised yet' : `${practised} of ${s.sentences.length} practised`}</span>
        <span className="grow" />
        {s.sentences.length > 0 && <Link className="btn small" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise</Link>}
      </div>
      <input type="checkbox" className="check source-card-check" checked={selected} onChange={onToggle} aria-label={`Select ${title}`} />
    </li>
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
