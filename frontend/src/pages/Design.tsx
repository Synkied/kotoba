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
  ['sheet', 'Sheet, rail, kraft'], ['ink', 'Ink and burgundy'], ['type', 'Type'], ['space', 'Frames and space'],
  ['buttons', 'Buttons'], ['tags', 'Chips and plates'], ['fields', 'Fields'], ['surfaces', 'Panels and notices'],
  ['sentences', 'Sentences and scores'], ['motion', 'Motion'],
]

export default function DesignPage() {
  const [pressed, setPressed] = useState<string[]>(['lesson 18'])
  const [model, setModel] = useState<'native' | 'tts'>('native')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState(true)
  const toast = useToast()

  return (
    <div className="ds">
      <header className="page-head">
        <h1><PageHome to="/design">Design system</PageHome> <span className="meta">tokens and components, live</span></h1>
      </header>

      <p className="ds-lede">
        A Muji-labelled study shelf: a white sheet where the Japanese sentence is the largest, calmest thing,
        and the facts about it sit on small kraft labels. Colours, type, space and motion live in <code>styles/tokens.css</code>;
        component styles in <code>styles/components/</code>; React primitives in <code>components/ds</code>.
        Change a token and every page follows. Rules and reasons are in <code>DESIGN.md</code>.
      </p>

      <nav className="ds-index" aria-label="On this page">
        {SECTIONS.map(([id, name]) => <a key={id} href={'#' + id}>{name}</a>)}
      </nav>

      <Section id="sheet" title="Sheet, rail, kraft" use={<>Every section reads on the same white sheet; the rail and its burgundy marker say where you are. Facts about a sentence (source, time, tries, labels) are kraft labels. The current row sits on the wash with a burgundy edge.</>}>
        <div className="ds-swatch-groups">
          <ul className="ds-swatches">
            <Swatch token="--page" note="the sheet, every section" />
            <Swatch token="--rail" note="the nav rail" />
            <Swatch token="--rail-hover" note="a rail link under the pointer" />
            <Swatch token="--wash" note="the current row, quiet fills" />
          </ul>
          <ul className="ds-swatches">
            <Swatch token="--kraft" on="--kraft-ink" note="labels, source tags, selection" />
            <Swatch token="--brand" on="--on-brand" note="the 言葉 KOTOBA block" />
          </ul>
        </div>
        <ol className="rows ds-rows">
          <li className="row row-lead">
            <span className="tc num" aria-hidden="true">01</span>
            <div className="ds-row-text"><SentenceText><Furigana text="ミラーさんは漢字を読むことができます。" pairs={[['漢字', 'かんじ'], ['読', 'よ']]} show lookup={false} /><span className="translation">Mr Miller can read kanji.</span></SentenceText><Chip className="source-tag"><a href="#sheet">lesson_18.mp3</a><span>0:41</span></Chip></div>
            <span className="record"><Stamp s={{ id: 3, overall: 94, accuracy: 94, clarity: 94, fluency: 94 }} /></span>
          </li>
          <li className="row row-lead now">
            <span className="tc num" aria-hidden="true">02</span>
            <div className="ds-row-text"><SentenceText><span lang="ja"><Units units={UNITS} /></span><span className="translation">I can play the piano.</span></SentenceText><Chip className="source-tag"><a href="#sheet">lesson_18.mp3</a><span>1:07</span></Chip></div>
            <span className="record"><Stamp s={{ id: 5, overall: 38, accuracy: 38, clarity: 38, fluency: 38 }} /></span>
          </li>
        </ol>
      </Section>

      <Section id="ink" title="Ink and burgundy" use={<>Near-black ink at three strengths on white. One accent, burgundy, and only for what is due, missed, current or recording, and 可 stamps. Grades ink the stamps. In dark, burgundy text lifts to a lighter red.</>}>
        <div className="ds-swatch-groups">
          <div>
            <h3>Ink and paper</h3>
            <ul className="ds-swatches">
              <Swatch token="--ink" note="text, button outlines" />
              <Swatch token="--ink-2" note="secondary text" />
              <Swatch token="--ink-3" note="meta, ≥5.9:1 on the sheet and rail" />
              <Swatch token="--paper" note="inputs, balloons, sheets" />
              <Swatch token="--paper-hover" note="a card under the pointer" />
              <Swatch token="--on-ink" note="text on ink" />
              <Swatch token="--rule" note="hairline between rows" />
              <Swatch token="--rule-strong" note="field and panel frames" />
            </ul>
          </div>
          <div>
            <h3>The accent</h3>
            <ul className="ds-swatches">
              <Swatch token="--accent" on="--on-accent" note="record, due, miss, current" />
              <Swatch token="--accent-ink" note="burgundy as text" />
              <Swatch token="--accent-wash" note="behind an error" />
              <Swatch token="--accent-press" note="the accent under the pointer" />
            </ul>
            <h3>Stamp inks</h3>
            <ul className="ds-swatches">
              <Swatch token="--stamp-shu" note="秀 ≥ 90" />
              <Swatch token="--stamp-yu" note="優 ≥ 75" />
              <Swatch token="--stamp-ryo" note="良 ≥ 50" />
            </ul>
          </div>
          <div>
            <h3>Kind dyes</h3>
            <ul className="ds-swatches">
              <Swatch token="--dye-folder" on="--on-dye-folder" note="藍 folders" />
              <Swatch token="--dye-lesson" on="--on-dye-lesson" note="萌葱 lessons" />
              <Swatch token="--dye-note" on="--on-dye-note" note="山吹 notes" />
              <Swatch token="--dye-media" on="--on-dye-media" note="柿 recordings" />
              <Swatch token="--dye-doc" on="--on-dye-doc" note="紫 PDFs, images, text" />
              <Swatch token="--dye-source" on="--on-dye-source" note="浅葱 sources" />
            </ul>
          </div>
          <div>
            <h3>Lights</h3>
            <ul className="ds-swatches">
              <Swatch token="--ok" note="engine ready" />
              <Swatch token="--warn" note="engine degraded" />
            </ul>
          </div>
        </div>
      </Section>

      <Section id="type" title="Type" use={<>Zen Kaku Gothic New, self-hosted, at 400, 500 and 700. The Japanese sentence is the largest reading size; rank comes from size steps and weight 500, numbers are tabular.</>}>
        <div className="ds-type">
          <div className="ds-type-row"><code>--t-xl</code><span className="meta num">2.25rem</span><span style={{ fontSize: 'var(--t-xl)', fontWeight: 'var(--w-medium)', lineHeight: 1.2 }}>Lesson 18　できること</span></div>
          <div className="ds-type-row"><code>--t-l</code><span className="meta num">1.75rem</span><span style={{ fontSize: 'var(--t-l)', fontWeight: 'var(--w-medium)' }}>No decks yet</span></div>
          <div className="ds-type-row"><code>--t-read</code><span className="meta num">1.4375rem</span><span className="ds-ruby" lang="ja"><Furigana text="趣味は写真を撮ることです。" pairs={[['趣味', 'しゅみ'], ['写真', 'しゃしん'], ['撮', 'と']]} show lookup={false} /></span></div>
          <div className="ds-type-row"><code>--t-fig</code><span className="meta num">1.5rem</span><span className="num" style={{ fontSize: 'var(--t-fig)', fontWeight: 'var(--w-medium)' }}>9 · 71 · 21</span></div>
          <div className="ds-type-row"><code>--t-m</code><span className="meta num">1rem</span><span>Body and controls. 日本語を話すことができます。</span></div>
          <div className="ds-type-row"><code>--t-sub</code><span className="meta num">.9375rem</span><span style={{ fontSize: 'var(--t-sub)', color: 'var(--ink-2)' }}>English glosses, nav, secondary lines.</span></div>
          <div className="ds-type-row"><code>--t-s</code><span className="meta num">.8125rem</span><span style={{ fontSize: 'var(--t-s)' }}>Meta, crumbs, filters, labels. <b>700 for counts.</b></span></div>
          <div className="ds-type-row"><code>--t-tag</code><span className="meta num">11px</span><span style={{ fontSize: 'var(--t-tag)' }}>Keys and the phone tab bar only, never reading text.</span></div>
          <div className="ds-type-row"><code>rank</code><span className="meta">weight + plate</span><span><b>Lesson 18</b> <Plate>textbook</Plate> <Plate tone="hollow">3 due</Plate></span></div>
        </div>
      </Section>

      <Section id="space" title="Frames and space" use={<>Hairlines everywhere: 1px frames on panels, sheets and fields, square. One 2px ink rule opens a page or a list. No texture: quiet comes from space and the third ink. Space steps 4 to 64.</>}>
        <div className="ds-frames">
          <Specimen label="--frame · panels, fields"><div className="ds-frame" style={{ border: 'var(--frame) solid var(--rule-strong)' }} /></Specimen>
          <Specimen label="--frame-head · under a page head"><div className="ds-frame" style={{ borderTop: 'var(--frame-head) solid var(--ink)' }} /></Specimen>
          <Specimen label="--wash · the current row"><div className="ds-frame" style={{ background: 'var(--wash)', boxShadow: 'inset 3px 0 0 var(--accent)' }} /></Specimen>
          <Specimen label="--lift · popovers, a card under the pointer"><div className="ds-frame" style={{ background: 'var(--paper-hover)', boxShadow: 'var(--lift)' }} /></Specimen>
        </div>
        <ol className="ds-space">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <li key={n}><code>--s-{n}</code><i style={{ width: `var(--s-${n})` }} /><span className="meta num">{[4, 8, 12, 16, 24, 32, 48, 64][n - 1]}px</span></li>
          ))}
        </ol>
      </Section>

      <Section id="buttons" title="Buttons" use={<><code>&lt;Button&gt;</code>, <code>&lt;ButtonLink&gt;</code>, or <code>buttonClass()</code> on another element. Ink for the main action, an ink outline for the rest, ghost inside dense rows, burgundy only to record. 44px on touch.</>}>
        <div className="ds-matrix" role="table" aria-label="Button variants">
          <div role="row" className="ds-matrix-head">
            <span role="columnheader" /><span role="columnheader">Regular</span><span role="columnheader">Small</span>
            <span role="columnheader">Icon</span><span role="columnheader">Disabled</span><span role="columnheader">Busy</span>
          </div>
          {([[undefined, 'Outline', Plus], ['primary', 'Primary', Play], ['ghost', 'Ghost', Trash2], ['accent', 'Record', Mic]] as const).map(([variant, name, Icon]) => (
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
          <Specimen label="recording: burgundy, pulsing while live"><Button type="button" variant="accent" className="rec on"><Square aria-hidden="true" />Stop</Button></Specimen>
          <Specimen label="toast with Undo"><Button type="button" size="small" onClick={() => toast({ text: 'Archived 3 sources.', undo: () => {} })}>Show a toast</Button></Specimen>
        </div>
      </Section>

      <Section id="tags" title="Chips and plates" use={<>Labels are kraft (<code>&lt;Chip&gt;</code>), like the tag tied to a product. Filters press to ink (<code>&lt;ChipButton aria-pressed&gt;</code>). Categories and counts are ink plates (<code>&lt;Plate&gt;</code>), burgundy only when due.</>}>
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
          <Specimen label="Plate · default, accent, hollow"><div className="chips"><Plate>textbook</Plate><Plate tone="accent">12 due</Plate><Plate tone="hollow">kept</Plate></div></Specimen>
          <Specimen label="Kbd"><span className="ds-keys"><Kbd>/</Kbd> search <Kbd>L</Kbd> listen <Kbd>Space</Kbd> record <Kbd>N</Kbd> next</span></Specimen>
        </div>
      </Section>

      <Section id="fields" title="Fields" use={<><code>&lt;Field&gt;</code> puts a label over its control. Inputs sit on paper in a hairline that turns ink on focus; an invalid one turns burgundy. Native selects and radios, always.</>}>
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

      <Section id="surfaces" title="Panels and notices" use={<>A panel is the source: screenshot, clip or text. A sheet holds a form. Notices take a hairline, errors burgundy with the recovery. Empty states say why and offer the one fix.</>}>
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

      <Section id="sentences" title="Sentences and scores" use={<>Browsing reads plain <code>&lt;SentenceText&gt;</code>. Practice puts the sentence in a calm <code>&lt;Balloon&gt;</code> whose outline is its state. Missed words get a burgundy underline, unclear ones a dashed one. Every attempt stamps it.</>}>
        <Specimen label="SentenceText · browsing at --t-read" wide><SentenceText>昨日、友達と一緒に東京へ行きました。<span className="roman">kinō, tomodachi to issho ni tōkyō e ikimashita.</span></SentenceText></Specimen>
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
