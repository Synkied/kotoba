import { Bookmark, Mic, Play, Plus, Search as SearchIcon, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Balloon } from '../components/Balloon'
import { Furigana, Units } from '../components/Furigana'
import { SentenceText } from '../components/SentenceText'
import { SourcePanel } from '../components/SourcePanel'
import { Stamp } from '../components/Stamp'
import type { Unit } from '../lib/api'
import { ErrorNotice, SearchBox, Skeleton, useToast, PageHome } from '../components/ui'
import {
  Button, ButtonLink, ButtonRow, Checkbox, Chip, ChipButton, EmptyState, Field, Input, Kbd, Notice, Panel, Plate,
  Segmented, Select, Sheet, Textarea,
} from '../components/ds'

/* The design system, live: every token and component as the app renders them.
   Change tokens.css or a component and this page shows the result in both themes. */

const UNITS: Unit[] = [
  { text: 'ピアノを', status: 'ok', conf: null }, { text: '弾く', status: 'missed', conf: null },
  { text: 'ことが', status: 'unclear', conf: null }, { text: 'できます', status: 'ok', conf: null },
]

const STOCKS = ['inbox', 'sources', 'decks', 'library', 'practice', 'review', 'words', 'recordings', 'collect'] as const
type Stock = (typeof STOCKS)[number]

const dark = window.matchMedia('(prefers-color-scheme: dark)')
const useDark = () => useSyncExternalStore((f) => { dark.addEventListener('change', f); return () => dark.removeEventListener('change', f) }, () => dark.matches, () => false)

/** The colour a token resolves to right now, as hex, read off the swatch itself. */
function useResolved(ref: React.RefObject<HTMLElement | null>, prop: 'backgroundColor' | 'color' = 'backgroundColor') {
  const isDark = useDark()
  const [v, setV] = useState('')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const m = getComputedStyle(el)[prop].match(/[\d.]+/g)
    if (!m) return
    const [r, g, b, a] = m.map(Number)
    const hex = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
    setV(a != null && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex)
  }, [ref, prop, isDark])
  return v
}

function Swatch({ token, note, on }: { token: string; note?: string; on?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const value = useResolved(ref)
  return (
    <li className="ds-swatch">
      <span ref={ref} className="ds-chip" style={{ background: `var(${token})`, color: on ? `var(${on})` : undefined }} aria-hidden="true">{on ? 'Aa' : ''}</span>
      <code>{token}</code>
      <span className="meta num">{value}</span>
      {note && <span className="meta">{note}</span>}
    </li>
  )
}

function Section({ id, title, use, children }: { id: string; title: string; use: ReactNode; children: ReactNode }) {
  return (
    <section className="ds-section" aria-labelledby={id}>
      <header className="ds-section-head">
        <h2 id={id}>{title}</h2>
        <p>{use}</p>
      </header>
      {children}
    </section>
  )
}

function Specimen({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={'ds-specimen' + (wide ? ' wide' : '')}>
      <div className="ds-stage">{children}</div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

const SECTIONS: [string, string][] = [
  ['stocks', 'Stocks'], ['ink', 'Ink and red'], ['type', 'Type'], ['space', 'Frames and space'],
  ['buttons', 'Buttons'], ['tags', 'Chips and plates'], ['fields', 'Fields'], ['surfaces', 'Panels and notices'],
  ['sentences', 'Sentences and scores'], ['motion', 'Motion'],
]

export default function DesignPage() {
  const [stock, setStock] = useState<Stock>('collect')
  const [pressed, setPressed] = useState<string[]>(['lesson 18'])
  const [model, setModel] = useState<'native' | 'tts'>('native')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState(true)
  const toast = useToast()

  return (
    <div className="ds" style={{ ['--stock' as string]: `var(--stock-${stock})` }}>
      <header className="page-head">
        <h1><PageHome to="/design">Design system</PageHome> <span className="meta">tokens and components, live</span></h1>
        <span className="grow" />
        <label className="ds-stock-pick">
          <span className="meta">Print on</span>
          <Select value={stock} onChange={(e) => setStock(e.target.value as Stock)}>
            {STOCKS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} stock</option>)}
          </Select>
        </label>
      </header>

      <p className="ds-lede">
        A weekly manga magazine of your own sentences. Colours, type, space and motion live in <code>styles/tokens.css</code>;
        component styles in <code>styles/components/</code>; React primitives in <code>components/ds</code>.
        Change a token and every page follows. Rules and reasons are in <code>DESIGN.md</code>.
      </p>

      <nav className="ds-index" aria-label="On this page">
        {SECTIONS.map(([id, name]) => <a key={id} href={'#' + id}>{name}</a>)}
      </nav>

      <Section id="stocks" title="Stocks" use={<>Each section is printed on its own newsprint; the ground does the wayfinding. Pick one to see this page on it.</>}>
        <ul className="ds-stocks">
          {STOCKS.map((s) => (
            <li key={s}>
              <button type="button" className="ds-stock" aria-pressed={stock === s} onClick={() => setStock(s)}
                style={{ background: `var(--stock-${s})` }}>
                <b>{s[0].toUpperCase() + s.slice(1)}</b>
                <code>--stock-{s}</code>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="ink" title="Ink and red" use={<>Near-black ink at three strengths on paper. One red, and only for recording, misses, due counts and 可 stamps. Grades ink the stamps.</>}>
        <div className="ds-swatch-groups">
          <div>
            <h3>Ink and paper</h3>
            <ul className="ds-swatches">
              <Swatch token="--ink" note="text, frames" />
              <Swatch token="--ink-2" note="secondary text" />
              <Swatch token="--ink-3" note="meta, ≥4.5:1 on every stock" />
              <Swatch token="--paper" note="balloons, inputs, sheets" />
              <Swatch token="--paper-hover" note="a card under the pointer" />
              <Swatch token="--on-ink" note="text on a black plate" />
              <Swatch token="--rule" note="hairline between rows" />
              <Swatch token="--rule-strong" note="a rule that groups" />
            </ul>
          </div>
          <div>
            <h3>The red</h3>
            <ul className="ds-swatches">
              <Swatch token="--red" on="--on-red" note="record, due, miss" />
              <Swatch token="--red-ink" note="red as text" />
              <Swatch token="--red-wash" note="behind a miss" />
              <Swatch token="--red-press" note="red under the pointer" />
            </ul>
            <h3>Stamp inks</h3>
            <ul className="ds-swatches">
              <Swatch token="--stamp-shu" note="秀 ≥ 90" />
              <Swatch token="--stamp-yu" note="優 ≥ 75" />
              <Swatch token="--stamp-ryo" note="良 ≥ 50" />
            </ul>
          </div>
          <div>
            <h3>Spine and lights</h3>
            <ul className="ds-swatches">
              <Swatch token="--spine" on="--spine-ink" note="the nav plate" />
              <Swatch token="--spine-2" note="hover on the spine" />
              <Swatch token="--ok" note="engine ready" />
              <Swatch token="--warn" note="engine degraded" />
              <Swatch token="--ok-on-spine" />
              <Swatch token="--warn-on-spine" />
            </ul>
          </div>
        </div>
      </Section>

      <Section id="type" title="Type" use={<>アンチック体: kanji in BIZ UDPGothic, kana in BIZ UDPMincho. Three sizes only; rank comes from weight and black reversal, never from a fourth size.</>}>
        <div className="ds-type">
          <div className="ds-type-row"><code>--t-l</code><span className="meta num">1.75rem</span><span style={{ fontSize: 'var(--t-l)' }} lang="ja">昨日、友達と東京へ行きました。</span></div>
          <div className="ds-type-row"><code>--t-m</code><span className="meta num">1rem</span><span lang="ja">日本語を話すことができます。 Body and sentences.</span></div>
          <div className="ds-type-row"><code>--t-s</code><span className="meta num">.8125rem</span><span style={{ fontSize: 'var(--t-s)' }}>Buttons, meta, labels. <b>Bold for rank.</b></span></div>
          <div className="ds-type-row"><code>--t-tag</code><span className="meta num">11px</span><span><span className="ds-tag">Capture</span> Uppercase reversal tags and keys only, never reading text.</span></div>
          <div className="ds-type-row"><code>rank</code><span className="meta">weight + plate</span><span><b>Lesson 18</b> <Plate>textbook</Plate> <Plate tone="hollow">3 due</Plate></span></div>
          <div className="ds-type-row"><code>ruby</code><span className="meta">furigana</span><span className="ds-ruby" lang="ja"><Furigana text="趣味は写真を撮ることです。" pairs={[['趣味', 'しゅみ'], ['写真', 'しゃしん'], ['撮', 'と']]} lookup={false} /></span></div>
          <div className="ds-type-row"><code>--mono</code><span className="meta">times, data</span><span className="num" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--t-s)' }}>0:12.4 → 0:15.9 · 3.5 s</span></div>
        </div>
      </Section>

      <Section id="space" title="Frames and space" use={<>Panels take the bold 3px frame, square. Controls and balloons take the thin 1.5px frame; only controls round, by 3px. Space steps 4 to 64.</>}>
        <div className="ds-frames">
          <Specimen label="--frame-bold · panels"><div className="ds-frame" style={{ border: 'var(--frame-bold) solid var(--ink)' }} /></Specimen>
          <Specimen label="--frame-thin · controls"><div className="ds-frame" style={{ border: 'var(--frame-thin) solid var(--ink)', borderRadius: 'var(--radius-control)' }} /></Specimen>
          <Specimen label=".tone · screentone, to push back"><div className="ds-frame tone" style={{ border: 'var(--frame-thin) solid var(--ink-3)' }} /></Specimen>
          <Specimen label="--lift · a card under the pointer"><div className="ds-frame" style={{ background: 'var(--paper-hover)', boxShadow: 'var(--lift)', border: '1px solid var(--ink)' }} /></Specimen>
        </div>
        <ol className="ds-space">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <li key={n}><code>--s-{n}</code><i style={{ width: `var(--s-${n})` }} /><span className="meta num">{[4, 8, 12, 16, 24, 32, 48, 64][n - 1]}px</span></li>
          ))}
        </ol>
      </Section>

      <Section id="buttons" title="Buttons" use={<><code>&lt;Button&gt;</code>, <code>&lt;ButtonLink&gt;</code>, or <code>buttonClass()</code> on another element. Ink for the main action, paper for the rest, ghost inside dense rows, red only to record. 44px on touch.</>}>
        <div className="ds-matrix" role="table" aria-label="Button variants">
          <div role="row" className="ds-matrix-head">
            <span role="columnheader" /><span role="columnheader">Regular</span><span role="columnheader">Small</span>
            <span role="columnheader">Icon</span><span role="columnheader">Disabled</span><span role="columnheader">Busy</span>
          </div>
          {([[undefined, 'Paper', Plus], ['primary', 'Primary', Play], ['ghost', 'Ghost', Trash2], ['red', 'Red', Mic]] as const).map(([variant, name, Icon]) => (
            <div role="row" key={name}>
              <code role="rowheader">{variant ?? 'default'}</code>
              <span role="cell"><Button type="button" variant={variant}><Icon aria-hidden="true" />{name}</Button></span>
              <span role="cell"><Button type="button" variant={variant} size="small"><Icon aria-hidden="true" />{name}</Button></span>
              <span role="cell"><Button type="button" variant={variant} icon aria-label={name}><Icon aria-hidden="true" /></Button></span>
              <span role="cell"><Button type="button" variant={variant} disabled><Icon aria-hidden="true" />{name}</Button></span>
              <span role="cell"><Button type="button" variant={variant} aria-busy="true"><Icon aria-hidden="true" />{name}</Button></span>
            </div>
          ))}
        </div>
        <div className="ds-row">
          <Specimen label="ButtonRow · Kbd inside"><ButtonRow><Button type="button" variant="primary"><Play aria-hidden="true" />Practise <Kbd>P</Kbd></Button><ButtonLink to="/decks">Open decks</ButtonLink></ButtonRow></Specimen>
          <Specimen label="recording: red, filled while live"><Button type="button" variant="red" className="rec on"><Square aria-hidden="true" />Stop</Button></Specimen>
          <Specimen label="toast with Undo"><Button type="button" size="small" onClick={() => toast({ text: 'Archived 3 sources.', undo: () => {} })}>Show a toast</Button></Specimen>
        </div>
      </Section>

      <Section id="tags" title="Chips and plates" use={<>Labels are boxed 1px (<code>&lt;Chip&gt;</code>). Filters are pressable (<code>&lt;ChipButton aria-pressed&gt;</code>). Categories and counts are black plates (<code>&lt;Plate&gt;</code>), red only when due.</>}>
        <div className="ds-row">
          <Specimen label="Chip · labels"><div className="chips"><Chip>minna no nihongo</Chip><Chip>lesson 18</Chip><Chip>game</Chip></div></Specimen>
          <Specimen label="ChipButton · filters">
            <div className="chips" role="group" aria-label="Labels">
              {['lesson 18', 'game', 'anime'].map((l) => (
                <ChipButton type="button" key={l} aria-pressed={pressed.includes(l)}
                  onClick={() => setPressed((p) => p.includes(l) ? p.filter((x) => x !== l) : [...p, l])}>
                  {l} <span className="n">{l.length}</span>
                </ChipButton>
              ))}
            </div>
          </Specimen>
          <Specimen label="Plate · default, red, hollow"><div className="chips"><Plate>textbook</Plate><Plate tone="red">12 due</Plate><Plate tone="hollow">kept</Plate></div></Specimen>
          <Specimen label="Kbd"><span className="ds-keys"><Kbd>/</Kbd> search <Kbd>L</Kbd> listen <Kbd>Space</Kbd> record <Kbd>N</Kbd> next</span></Specimen>
        </div>
      </Section>

      <Section id="fields" title="Fields" use={<><code>&lt;Field&gt;</code> puts a bold label over its control. Inputs sit on paper in the thin frame; an invalid one turns red. Native selects and radios, always.</>}>
        <div className="ds-fields">
          <Field><span>Deck name</span><Input placeholder="e.g. Lesson 19" /></Field>
          <Field><span>Invalid</span><Input aria-invalid="true" defaultValue="lesson 18, game, anime, extra" /></Field>
          <Field><span>Voice</span><Select defaultValue="browser"><option value="browser">Browser voice</option><option>Kokoro</option></Select></Field>
          <Field><span>Search</span><SearchBox value={query} onChange={setQuery} placeholder="tokyo finds 東京" /></Field>
          <Field className="wide"><span>Note</span><Textarea defaultValue="と is the quoting particle here." /></Field>
          <div className="ds-field-inline">
            <label className="ds-check"><Checkbox type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />Select this source</label>
            <Segmented role="radiogroup" aria-label="Model voice" name="ds-model" value={model} onChange={setModel}
              options={[{ value: 'native', label: 'Native' }, { value: 'tts', label: 'Voice' }]} />
          </div>
        </div>
      </Section>

      <Section id="surfaces" title="Panels and notices" use={<>A panel is the source: screenshot, clip or text. A sheet holds a form. Notices are framed in ink, errors in red with the recovery. Empty states say why and offer the one fix.</>}>
        <div className="ds-row">
          <Specimen label="SourcePanel · clip"><SourcePanel kind="audio" start={12.4} end={15.9} /></Specimen>
          <Specimen label="SourcePanel · text"><SourcePanel kind="text" /></Specimen>
          <Specimen label="Panel"><Panel className="ds-panel"><span className="kind">Capture</span></Panel></Specimen>
        </div>
        <div className="ds-stack">
          <Sheet aria-label="Example sheet"><h3>Sheet</h3><p className="meta">A framed paper area for a form or a group of settings.</p><ButtonRow><Button type="button" variant="primary" size="small">Save</Button><Button type="button" variant="ghost" size="small">Cancel</Button></ButtonRow></Sheet>
          <Notice><SearchIcon aria-hidden="true" /><span>Nothing matches <b>tokyo</b> in this deck. Search all sources instead.</span></Notice>
          <ErrorNotice error={new Error('Could not save the cuts. Check the connection to the hub.')} action={<Button type="button" size="small">Retry saving</Button>} />
          <EmptyState className="ds-empty">
            <h2>No decks yet</h2>
            <p>A deck is an ordered run of sentences you practise together. Create one, or add sentences from Sources.</p>
            <Button type="button"><Bookmark aria-hidden="true" />Create a deck</Button>
          </EmptyState>
          <Skeleton rows={2} />
        </div>
      </Section>

      <Section id="sentences" title="Sentences and scores" use={<>Browsing reads plain <code>&lt;SentenceText&gt;</code>. Practice puts the sentence in a <code>&lt;Balloon&gt;</code> whose outline is its state. Every attempt stamps it.</>}>
        <Specimen label="SentenceText · browsing" wide><SentenceText>昨日、友達と一緒に東京へ行きました。<span className="roman">kinō, tomodachi to issho ni tōkyō e ikimashita.</span></SentenceText></Specimen>
        <div className="ds-balloons">
          <Specimen label="round · at rest, the model line"><Balloon tail="left">すみません、駅はどこですか。</Balloon></Specimen>
          <Specimen label="burst · recording"><Balloon shape="burst" live tail="left">すみません、駅はどこですか。</Balloon></Specimen>
          <Specimen label="dashed · heard unclearly"><Balloon shape="dashed" tail="left">すみません、駅はどこですか。</Balloon></Specimen>
          <Specimen label="dim · a neighbour"><Balloon dim>この本はとても面白いです。</Balloon></Specimen>
        </div>
        <div className="ds-row">
          <Specimen label="Stamp · 秀 優 良 可">
            <span className="ds-stamps">
              {[94, 81, 62, 38].map((n, i) => <Stamp key={n} s={{ id: i + 3, overall: n, accuracy: n, clarity: n, fluency: n }} />)}
            </span>
          </Specimen>
          <Specimen label="Stamp big"><Stamp big s={{ id: 7, overall: 92, accuracy: 95, clarity: 90, fluency: 88 }} /></Specimen>
          <Specimen label="Units · ok, missed, unclear">
            <span className="ds-units" lang="ja"><Units units={UNITS} /></span>
          </Specimen>
        </div>
      </Section>

      <Section id="motion" title="Motion" use={<>Quick and quiet: 120ms for hover, 160ms for state, one ease. No page-load choreography. The only show is a fresh score stamp landing. Reduced motion turns it all off.</>}>
        <ul className="ds-motion">
          <li><code>--t-fast</code><span className="meta num">120ms</span><span>hover</span></li>
          <li><code>--t-state</code><span className="meta num">160ms</span><span>state changes, toasts, docks</span></li>
          <li><code>--ease</code><span className="meta num">cubic-bezier(.2, .7, .2, 1)</span><span>everything</span></li>
        </ul>
      </Section>
    </div>
  )
}
