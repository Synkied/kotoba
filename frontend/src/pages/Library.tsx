import { Copy, Check, Play, Tag, X, AudioLines, BookAudio, Clapperboard, Captions, Type, Camera } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Source, type SourceKind } from '../lib/api'
import { DeckPicker } from '../components/DeckPicker'
import { fmtTime } from '../components/SourcePanel'
import { Stamp } from '../components/Stamp'
import { KindTile } from '../components/Kind'
import type { Dye } from '../lib/dyes'
import { MAX_LABELS, mergeLabels, parseLabels } from '../lib/labels'
import { ErrorNotice, SearchBox, Skeleton, clock, dayLabel, useAsync, useToast, useAction, PageHome } from '../components/ui'
import { Button, ButtonLink, Checkbox, Chip, ChipButton, EmptyState, Field, Input, Plate, Select } from '../components/ds'
import { SourcesTabs } from '../components/SourcesTabs'
import { useOnPractised, usePractise } from '../lib/practise'

const KINDS: { id: SourceKind | ''; name: string }[] = [
  { id: '', name: 'All' }, { id: 'capture', name: 'Captures' }, { id: 'audio', name: 'Audio' },
  { id: 'video', name: 'Video' }, { id: 'subtitle', name: 'Subtitles' }, { id: 'text', name: 'Text' }, { id: 'story', name: 'Stories' },
]
const KIND = {
  capture: { name: 'Capture', Icon: Camera, dye: 'doc' }, audio: { name: 'Audio', Icon: AudioLines, dye: 'media' }, video: { name: 'Video', Icon: Clapperboard, dye: 'media' },
  subtitle: { name: 'Subtitles', Icon: Captions, dye: 'doc' }, text: { name: 'Text', Icon: Type, dye: 'doc' }, story: { name: 'Story', Icon: BookAudio, dye: 'doc' },
} satisfies Record<SourceKind, { name: string; Icon: unknown; dye: Dye }>
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
  const practise = usePractise()
  const facets = useAsync(() => api.facets(), [])
  const { data, error, loading, reload } = useAsync(
    () => api.sources({ status: 'kept', q, kind: kind || undefined, limit, category, label }),
    [q, kind, category, label, limit])
  useOnPractised(reload)

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

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/sources">Sources</PageHome> <span className="meta num">{data ? plural(data.count, 'source') : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={setQ} placeholder="Look up a sentence, label or reading" /></div>
      </header>
      <SourcesTabs />

      {/* one line: the kind as a row of quiet toggles, labels and categories as menus (a card's own tags filter too) */}
      <div className="source-filters" role="group" aria-label="Filters">
        <div className="source-kinds" role="group" aria-label="Kind">
          {KINDS.map((k) => {
            const Icon = k.id ? KIND[k.id].Icon : null
            return <button key={k.id} type="button" className="source-kind" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{Icon && <Icon aria-hidden="true" />}{k.name}</button>
          })}
        </div>
        <span className="grow" />
        {labels.length > 0 && (
          <Select className="chip-select source-facet" aria-label="Label" data-on={label ? true : undefined} value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">Any label</option>
            {/* a label filtered from a card before the facets refresh still shows */}
            {label && !labels.some(l => l.name === label) && <option value={label}>{label}</option>}
            {labels.map(l => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}
          </Select>
        )}
        {categories.length > 0 && (
          <Select className="chip-select source-facet" aria-label="Category" data-on={category ? true : undefined} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any category</option>
            {category && !categories.some(c => c.name === category) && <option value={category}>{category}</option>}
            {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </Select>
        )}
        {filtered && <Button variant="ghost" size="small" onClick={() => { setQ(''); setKind(''); setCategory(''); setLabel('') }}><X aria-hidden="true" />Clear</Button>}
      </div>

      {selected.size > 0 && (
        <div className="toolbar active selection-dock" role="toolbar" aria-label="Selection">
          <span className="num" style={{ fontWeight: 700 }}>{plural(selected.size, 'source')} · {plural(sentenceIds.length, 'sentence')}</span>
          <DeckPicker small sentenceIds={() => sentenceIds} onDone={clearSelection} />
          <Button size="small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} disabled={!sentenceIds.length}
            onClick={() => practise.open({ ids: sentenceIds })}><Play aria-hidden="true" />Practise these</Button>
          <Button variant="ghost" size="small" disabled={labelAction.busy} aria-expanded={labelDraft !== null} onClick={() => setLabelDraft(d => d === null ? '' : null)}><Tag aria-hidden="true" />Add labels</Button>
          <span className="grow" />
          <Button variant="ghost" size="small" disabled={labelAction.busy} onClick={clearSelection}>Clear</Button>
          {labelDraft !== null && <form className="bulk-label-form" onSubmit={addLabels} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLabelDraft(null) } }}>
            <Field><span>Labels for {plural(selectedSources.length, 'source')}, separated by commas</span>
              <Input autoFocus maxLength={130} list="library-labels" value={labelDraft} disabled={labelAction.busy}
                aria-invalid={full.length > 0 || undefined} aria-describedby="bulk-label-help"
                onChange={e => { setLabelDraft(e.target.value); labelAction.clearError() }} placeholder="minna no nihongo, lesson 18" /></Field>
            <datalist id="library-labels">{labels.map(l => <option key={l.name} value={l.name} />)}</datalist>
            <Button size="small" style={{ background: 'var(--on-ink)', color: 'var(--ink)' }} disabled={labelAction.busy || !adding.length}>{labelAction.busy ? 'Adding…' : adding.length > 1 ? `Add ${adding.length} labels` : 'Add label'}</Button>
            <Button type="button" variant="ghost" size="small" disabled={labelAction.busy} onClick={() => setLabelDraft(null)}>Cancel</Button>
            <div id="bulk-label-help" className="bulk-label-help">
              {adding.length > 0 && <div className="chips" aria-label="Labels to add">{adding.map(l => <Chip key={l}>{l}</Chip>)}</div>}
              <p className="meta">{full.length
                ? `${full.length === 1 ? 'One selected source already has' : `${full.length} selected sources already have`} too many labels for this. Up to ${MAX_LABELS} per source.`
                : `Existing labels are kept; up to ${MAX_LABELS} per source.`}</p>
            </div>
            {labelAction.error != null && <ErrorNotice error={labelAction.error} />}
          </form>}
        </div>
      )}

      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        loading && !data ? <Skeleton /> :
        !groups.length ? (
          <EmptyState>
            <h2>{filtered ? 'Nothing matches' : 'No sources yet'}</h2>
            <p>{filtered ? 'Try fewer filters, or search by reading: “kyou” finds 今日.' : 'Sources you keep from the inbox live here, with every sentence and every attempt at saying it.'}</p>
            {!filtered && <ButtonLink variant="primary" to="/inbox">Go to the inbox</ButtonLink>}
          </EmptyState>
        ) : <div className="source-days">{groups.map((day) => {
          const { date, rel } = dayLabel(day.items[0].s.created_at)
          return (
            <section className="day" key={day.key} aria-label={date}>
              <div className="day-head"><span className="date">{date}</span>{rel && <span className="meta">{rel}</span>}</div>
              <ul className="source-list">
                {day.items.map(({ s, n }) => <SourceRow key={s.id} s={s} n={n} q={q} selected={selected.has(s.id)} onToggle={() => toggle(s.id)}
                  label={label} category={category} onLabel={filterLabel} onCategory={filterCategory} />)}
              </ul>
            </section>
          )
        })}</div>}
      {data && data.results.length < data.count && <Button disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more sources'}</Button>}
    </>
  )
}

/** One source as a ruled row: what it is (its screenshot, or its kind's tile), a line of it, its labels, and how far
 *  practice has got, sentence by sentence. The whole row opens the source. */
function SourceRow({ s, n, q, selected, onToggle, label, category, onLabel, onCategory }: {
  s: Source; n: number; q: string; selected: boolean; onToggle: () => void
  label: string; category: string; onLabel: (l: string) => void; onCategory: (c: string) => void
}) {
  const { name: kindName, Icon, dye } = KIND[s.kind]
  const needle = q.trim()
  // when searching, show the line that matched rather than the first one
  const line = (needle && s.sentences.find(x => x.text.includes(needle))) || s.sentences[0]
  const title = s.title || line?.text || s.text.slice(0, 80) || 'Untitled'
  const excerpt = s.title ? line?.text : s.sentences[1]?.text
  const latest = (x: Source['sentences'][number]) => x.stamps.reduce<typeof x.stamps[number] | undefined>((a, b) => (!a || b.created_at > a.created_at ? b : a), undefined)
  const practised = s.sentences.filter(x => x.stamps.length).length
  const practise = usePractise()
  const last = s.sentences.flatMap(x => x.stamps).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return (
    <li className="source-row" data-selected={selected || undefined}>
      <Checkbox type="checkbox" className="source-row-check" checked={selected} onChange={onToggle} aria-label={`Select ${title}`} />
      <div className="source-row-face">
        {s.image ? <img className="source-row-shot" src={s.image} alt="" loading="lazy" /> : <KindTile dye={dye} icon={Icon} />}
      </div>
      <div className="source-row-main">
        <h3 lang={s.title ? undefined : 'ja'}><Link to={`/sources/${s.id}`} className="source-row-link">{title}</Link></h3>
        {excerpt && <p className="source-row-line" lang="ja">{excerpt}</p>}
        <p className="meta source-row-meta num">
          <Icon aria-hidden="true" />{kindName}{s.duration ? ` · ${fmtTime(s.duration).replace(/\.\d$/, '')}` : ''} · {clock(s.created_at)}
          {n > 1 && <Plate tone="hollow" className="num" title={`Captured ${n} times`}>×{n}</Plate>}
        </p>
      </div>
      <div className="chips source-row-tags">
        {s.category && <button className="plate plate-filter" aria-pressed={category === s.category} title={`Show only “${s.category}”`} onClick={() => onCategory(s.category)}>{s.category}</button>}
        {s.labels.map((l) => <ChipButton key={l} aria-pressed={label === l} title={label === l ? 'Show all labels' : `Show only “${l}”`} onClick={() => onLabel(l)}>{l}</ChipButton>)}
      </div>
      <div className="source-row-progress">
        {last && <Stamp s={last} />}
        <div>
          <span className="meta num">{s.sentences.length === 0 ? 'No sentences yet' : practised === 0 ? plural(s.sentences.length, 'sentence') : `${practised} of ${plural(s.sentences.length, 'sentence')} practised`}</span>
          {/* one segment per sentence, as practice's progress rule: practised in ink, a weak last try in burgundy */}
          {s.sentences.length > 0 && <span className="practise-rule" aria-hidden="true" data-many={s.sentences.length > 24 || undefined}>
            {s.sentences.slice(0, 120).map(x => { const t = latest(x); return <i key={x.id} data-state={!t ? undefined : t.overall < 70 ? 'weak' : 'done'} /> })}
          </span>}
        </div>
      </div>
      <div className="source-row-acts">
        {s.sentences.length > 0 && <ButtonLink variant="ghost" size="small" {...practise.link({ source: s.id })}><Play aria-hidden="true" />Practise</ButtonLink>}
      </div>
    </li>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const toast = useToast()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button variant="ghost" size="small" icon aria-label={done ? 'Copied' : 'Copy'} title="Copy"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1400); toast({ text: 'Copied' }) } catch { toast({ text: 'Couldn’t copy. Select the text and copy it manually, or open kotoba over HTTPS.' }) } }}>
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}
