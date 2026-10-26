import { BookAudio, Check, LoaderCircle, Plus, RotateCcw, ListChecks, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type StoryLength, type StoryOptions, type StoryRegister, type StoryRow, type StoryState } from '../lib/api'
import { STORY_BUSY, STORY_LENGTH, STORY_STATE, unitLabel } from '../lib/stories'
import { fmtTime } from '../components/SourcePanel'
import { ErrorNotice, PageHome, Skeleton, dayLabel, useAction, useAsync, usePref } from '../components/ui'
import { Button, ButtonLink, ButtonRow, EmptyState, Field, Input, Notice, Plate, Segmented, Select, buttonClass } from '../components/ds'

const BUSY = STORY_BUSY, STATE_NAME = STORY_STATE, LENGTH_NAME = STORY_LENGTH
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
/** the steps a story goes through after it's asked for, as its card counts them */
const STEPS: StoryState[] = ['writing', 'checking', 'voicing']
/** the translation language by name (English), not code (en) */
const language = (code: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code } catch { return code }
}

/** Stories written for you inside what you've studied, and the form that asks for a new one. */
export default function StoriesPage() {
  const options = useAsync(() => api.storyOptions(), [])
  const list = useAsync(() => api.stories(), [])
  const busy = list.data?.some((s) => s.story.state && BUSY.includes(s.story.state))
  // while a story is being written, its card follows along
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(list.reload, 2500)
    return () => window.clearTimeout(t)
  }, [busy, list.data, list.reload])

  return <>
    <header className="page-head">
      <h1><PageHome to="/stories">Stories</PageHome></h1>
      <span className="grow" />
      {/* on a phone the stories come first, so the form is a jump away */}
      {list.data && list.data.length > 0 && <a className={buttonClass({ variant: 'primary', icon: true }, 'stories-jump')} href="#new-story" aria-label="New story" title="New story"><Plus aria-hidden="true" /></a>}
      <ButtonLink to="/stories/syllabi"><ListChecks aria-hidden="true" />Syllabi</ButtonLink>
    </header>
    <p className="meta stories-lead">Short stories written with only the words and grammar you've studied, read aloud, with furigana, translations and lookups like any source.</p>
    <div className="stories">
      {options.error != null ? <ErrorNotice error={options.error} action={<Button size="small" onClick={options.reload}>Try again</Button>} />
        : options.data ? <NewStory o={options.data} onWritten={(row) => list.set((prev) => [row, ...(prev ?? [])])} /> : <Skeleton rows={3} />}
      <section className="stories-list" aria-label="Your stories">
        <h2>Your stories {list.data && list.data.length > 0 && <span className="meta num">{list.data.length}</span>}</h2>
        {list.error != null && <ErrorNotice error={list.error} action={<Button size="small" onClick={list.reload}>Try again</Button>} />}
        {!list.data && list.error == null && <Skeleton rows={3} />}
        {list.data && !list.data.length && <EmptyState>
          <h2>No stories yet</h2>
          <p>Choose a level or a lesson and write one. It takes a minute or so: the writer, then a check of its words, then the voice.</p>
        </EmptyState>}
        {list.data && list.data.length > 0 && <ul className="source-cards">
          {list.data.map((s) => <StoryCard key={s.id} s={s} onChange={(row) => list.set((prev) => prev.map((x) => x.id === row.id ? row : x))} />)}
        </ul>}
      </section>
    </div>
  </>
}

function NewStory({ o, onWritten }: { o: StoryOptions; onWritten: (row: StoryRow) => void }) {
  const [params] = useSearchParams()
  // the form remembers what you last asked for; a lesson's "Make a story" link picks the unit
  const [last, setLast] = usePref<{ syllabus: string; unit: number; length: StoryLength; register: StoryRegister; voice: string }>(
    'story-form', { syllabus: 'jlpt', unit: 1, length: 'short', register: '', voice: '' })
  const [sid, setSid] = useState(() => params.get('syllabus') ?? String(last.syllabus))
  const syl = o.syllabi.find((x) => String(x.id) === sid) ?? o.syllabi[0]
  const [unit, setUnit] = useState(() => Number(params.get('unit') ?? last.unit))
  const u = syl.units.find((x) => x.number === unit) ?? syl.units.at(-1)
  const [length, setLength] = useState<StoryLength>(last.length)
  const [register, setRegister] = useState<StoryRegister>(last.register)
  const [voice, setVoice] = useState(() => o.voices.some((v) => v.id === last.voice) ? last.voice : o.voice ?? '')
  const [theme, setTheme] = useState('')
  const action = useAction()
  const words = useMemo(() => syl.units.filter((x) => u && x.number <= u.number).reduce((n, x) => n + x.vocab, 0), [syl, u])

  const write = () => action.run(async () => {
    if (!u) return
    const row = await api.writeStory({ syllabus: syl.id, unit: u.number, length, register, theme, voice })
    setLast({ syllabus: String(syl.id), unit: u.number, length, register, voice })
    setTheme('')
    onWritten(row)
    // on a phone the list sits above the form: show the new story's card being written
    requestAnimationFrame(() => document.querySelector(`[data-story="${row.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  })

  return <section className="story-form" aria-labelledby="new-story">
    <h2 id="new-story">New story</h2>
    <form onSubmit={(e) => { e.preventDefault(); write() }}>
      {/* the reason the form is shut comes before it, not after eight disabled fields */}
      {!o.writer && <Notice as="p"><span>Stories need an LLM to write them. <Link to="/addons#translations">Add one on the Add-ons page</Link>.</span></Notice>}
      <fieldset disabled={action.busy || !o.writer} className="story-fields">
        <Field><span>Syllabus</span>
          <Select value={String(syl.id)} onChange={(e) => { setSid(e.target.value); setUnit(Number.MAX_SAFE_INTEGER) }}>
            {o.syllabi.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
          </Select>
        </Field>
        <Field><span>{syl.bundled ? 'Level' : 'Studied up to'}</span>
          <Select value={u?.number ?? ''} onChange={(e) => setUnit(Number(e.target.value))} disabled={!syl.units.length}>
            {syl.units.map((x) => <option key={x.number} value={x.number}>{unitLabel(syl, x)}</option>)}
          </Select>
        </Field>
        <p className="meta story-scope">{!syl.units.length ? <>No units yet. <Link to={`/stories/syllabi/${syl.id}`}>Add the words you've studied</Link>.</>
          : u && <>{plural(words, 'word')} to draw on{u.vocab && u.vocab < words ? `, featuring the ${u.vocab.toLocaleString()} new in ${syl.bundled ? u.title : `unit ${u.number}`}` : ''}.</>}</p>
        <div className="field"><span id="story-length">Length</span>
          <Segmented name="story-length" aria-labelledby="story-length" role="radiogroup" value={length} onChange={setLength}
            options={(Object.keys(o.lengths) as StoryLength[]).map((k) => ({ value: k, label: LENGTH_NAME[k], title: `About ${o.lengths[k]} lines` }))} />
        </div>
        <div className="field"><span id="story-register">Speech</span>
          <Segmented name="story-register" aria-labelledby="story-register" role="radiogroup" value={register} onChange={setRegister}
            options={[{ value: '', label: 'Either' }, { value: 'polite', label: 'です・ます' }, { value: 'plain', label: 'Plain' }]} />
        </div>
        <Field className="story-theme"><span>Theme <span className="meta">(optional)</span></span>
          <Input value={theme} maxLength={200} onChange={(e) => setTheme(e.target.value)} placeholder="a lost umbrella, a weekend trip" />
        </Field>
        <Field><span>Voice</span>
          <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
            {!o.voices.length && <option value="">No voice yet</option>}
            {o.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
      </fieldset>
      {o.writer && <p className="meta story-writer">
        Written by <b>{o.writer.name}</b>{o.writer.model && ` (${o.writer.model})`}, with translations in {language(o.lang)}.{' '}
        {o.writer.cloud ? <><b>This spends API credits</b> and sends the word lists out.</> : 'Nothing leaves your machines.'}{' '}
        <Link to="/addons#translations">Choose another</Link>
      </p>}
      {!o.voices.length && <Notice as="p"><span>No voice is set up, so the story will have text but no audio until one is. <Link to="/addons">See the voices</Link>.</span></Notice>}
      {action.error != null && <ErrorNotice error={action.error} />}
      <ButtonRow>
        <Button variant="primary" disabled={action.busy || !o.writer || !u || !words} aria-busy={action.busy}>
          <BookAudio aria-hidden="true" />{action.busy ? 'Asking…' : 'Write the story'}
        </Button>
      </ButtonRow>
    </form>
  </section>
}

function StoryCard({ s, onChange }: { s: StoryRow; onChange: (row: StoryRow) => void }) {
  const action = useAction()
  const st = s.story.state ?? 'done'
  const busy = BUSY.includes(st)
  const { date, rel } = dayLabel(s.created_at)
  const day = rel || new Date(s.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const step = STEPS.indexOf(st)
  // before the writer answers there's no title or translation yet: the theme asked for stands in
  const line = s.story.title_tr || (s.story.theme && `“${s.story.theme}”`)
  return <li className="source-card story-card" data-state={st} data-story={s.id}>
    <div className="source-card-body">
      <h3>{s.title
        ? <Link className="source-card-link" to={`/sources/${s.id}`} lang="ja">{s.title}</Link>
        : <Link className="source-card-link story-untitled" to={`/sources/${s.id}`}>{busy ? 'A new story' : 'Untitled story'}</Link>}</h3>
      {line && <p className="source-card-line">{line}</p>}
      <p className="meta source-card-meta num">
        {s.story.unit_name} · {LENGTH_NAME[s.story.length]}
        {s.sentences > 0 && ` · ${plural(s.sentences, 'line')}`}{s.duration ? ` · ${fmtTime(s.duration).replace(/\.\d$/, '')}` : ''}
        {' · '}<time dateTime={s.created_at} title={date}>{day}</time>
      </p>
      {st === 'failed' && s.story.error && <p className="meta story-error">{s.story.error}</p>}
    </div>
    <div className="source-card-foot">
      {busy ? <>
        <span className="meta story-progress" role="status"><LoaderCircle className="loading-spinner" aria-hidden="true" />{STATE_NAME[st]}</span>
        <span className="story-steps" aria-hidden="true">{STEPS.map((x, i) => <i key={x} data-step={i < step ? 'done' : i === step ? 'now' : undefined} />)}</span>
      </> : st === 'failed' ? <span className="meta failed story-progress"><TriangleAlert aria-hidden="true" />{STATE_NAME.failed}{s.story.failed_at && ` while ${STATE_NAME[s.story.failed_at].replace('…', '').toLowerCase()}`}</span>
        : s.story.outside > 0 ? <Plate tone="hollow" className="num" title="Words outside the syllabus, marked in the text">{plural(s.story.outside, 'word')} beyond</Plate>
          : <span className="meta story-progress"><Check className="story-ok" aria-hidden="true" />Within the syllabus</span>}
      <span className="grow" />
      {st === 'failed' && <Button size="small" disabled={action.busy} aria-busy={action.busy} onClick={() => action.run(async () => onChange(await api.retryStory(s.id)))}><RotateCcw aria-hidden="true" />Try again</Button>}
      {st === 'done' && s.sentences > 0 && <ButtonLink size="small" variant="ghost" to={`/sources/${s.id}`} aria-label={`Listen to ${s.title || 'this story'}`}>Listen</ButtonLink>}
    </div>
    {action.error != null && <div className="story-card-error"><ErrorNotice error={action.error} /></div>}
  </li>
}
