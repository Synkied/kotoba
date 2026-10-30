import { BookAudio, BookOpen, ChevronLeft, Ellipsis, Info, Mic, MonitorPlay, Play, Volume2, Pencil, Check, Archive, Inbox as InboxIcon, Scissors, SkipBack, SkipForward, ListEnd, ListOrdered, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Sentence, type Source, type Story, type StoryOutside } from '../lib/api'
import { STORY_BUSY, STORY_STATE } from '../lib/stories'
import { useIndexWait } from '../lib/wordIndex'
import { stopAudio } from '../lib/audio'
import { WaveformPlayer, type PlayerHandle } from '../components/SentenceAudio'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SentenceEditor } from '../components/SentenceEditor'
import { MAX_LABELS, parseLabels } from '../lib/labels'
import { KIND_ICON, SourcePanel, fmtTime } from '../components/SourcePanel'
import { KindTile } from '../components/Kind'
import { Menu, MenuItem } from '../components/Menu'
import { Stamps } from '../components/Stamp'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, Skeleton, clock, dayLabel, useAsync, useToast, useAction } from '../components/ui'
import { ReadingAids, TranslateAll, Translation, useAids } from '../components/ReadingAids'
import { CopyButton } from './Library'
import { useBackTo } from '../lib/trail'
import { Button, ButtonLink, Chip, Input, Plate } from '../components/ds'
import { useOnPractised, usePractise } from '../lib/practise'
import { useStats } from '../App'

export default function SourcePage() {
  const id = Number(useParams().id)
  return <SourcePageDetail key={id} id={id} />
}

function SourcePageDetail({ id }: { id: number }) {
  const { data: s, error, set, reload } = useAsync(() => api.source(id), [id])
  const stats = useStats()
  // this source's own practice, clean-up and sentence pages lead back here, so Back skips past them
  const backTo = useBackTo(`source:${id}`, (p) => p.startsWith('/practice') || p.startsWith('/sentences/') || p === `/sources/${id}/cleanup` || p === `/sources/${id}`)
  const aids = useAids()
  const player = useRef<PlayerHandle>(null)
  // the playhead, once playback has started: it lights up the sentence being spoken
  const [head, setHead] = useState<{ t: number; playing: boolean } | null>(null)
  const onTime = useCallback((t: number, playing: boolean) => setHead((h) => (playing || h ? { t, playing } : h)), [])
  // the script follows the voice until the reader scrolls away on their own; one tap brings it back
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    // scrolling the player column or dragging across the waveform isn't leaving the script
    const away = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('.source-aside, dialog'))) setFollow(false) }
    const keys = (e: KeyboardEvent) => { if (['PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) away(e) }
    window.addEventListener('wheel', away, { passive: true })
    window.addEventListener('touchmove', away, { passive: true })
    window.addEventListener('keydown', keys)
    return () => { window.removeEventListener('wheel', away); window.removeEventListener('touchmove', away); window.removeEventListener('keydown', keys) }
  }, [])
  const [labels, setLabels] = useState<string | null>(null)
  const toast = useToast()
  const action = useAction()
  const practise = usePractise()
  useOnPractised(reload)
  useEffect(() => () => stopAudio(), [id])
  // a story being written: its lines, then its voice, arrive as each step finishes
  const writing = !!s?.story?.state && STORY_BUSY.includes(s.story.state)
  useEffect(() => {
    if (!writing) return
    const t = window.setTimeout(reload, 2500)
    return () => window.clearTimeout(t)
  }, [writing, s, reload])
  if (error) return <ErrorNotice error={error} action={<Button onClick={reload}>Try again</Button>} />
  if (!s) return <Skeleton rows={3} />

  const timed = s.media ? s.sentences.filter((x) => x.start != null && x.end != null) : []
  const current = head ? timed.find((x) => head.t >= x.start! && head.t < x.end!)?.id ?? null : null
  // the line we're on, or the last one begun (the gaps between lines belong to the line before)
  const at = head ? timed.findLastIndex((x) => x.start! <= head.t + .05) : -1
  const play = (x: Sentence) => {
    setFollow(true)
    if (current === x.id && head?.playing) player.current?.pause()
    else player.current?.playRange(x.start!, x.end!)
  }
  const playFrom = (x: Sentence) => { setFollow(true); player.current?.playFrom(x.start!) }
  // previous restarts the line you're in unless you're just past its start, like a music player
  const prevLine = timed[at >= 0 && head!.t - timed[at].start! > 1.5 ? at : at - 1]
  const nextLine = timed[at + 1]
  const status = async (st: Source['status']) => action.run(async () => { set(await api.updateSource(s.id, { status: st })); toast({ text: st === 'kept' ? 'Moved to Sources' : st === 'archived' ? 'Archived' : 'Back in the inbox' }) })
  const { date } = dayLabel(s.created_at)

  return (
    <>
      {action.error != null && <ErrorNotice error={action.error} />}
      <fieldset className="action-scope" disabled={action.busy} aria-busy={action.busy}>
      <header className="page-head source-head">
        <ButtonLink variant="ghost" icon to={backTo ?? (s.status === 'inbox' ? '/inbox' : '/sources')} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <KindTile dye="source" icon={KIND_ICON[s.kind]} size="large" />
        <div className="source-heading">
          <h1>{s.title || (s.kind === 'capture' ? 'Capture' : 'Source')}</h1>
          <p className="meta num">{{ capture: 'Capture', audio: 'Audio', video: 'Video', subtitle: 'Subtitles', text: 'Text', story: 'Story' }[s.kind]} · {s.sentences.length} sentences</p>
        </div>
        <div className="source-actions">
          {(s.job === 'waiting' || s.job === 'running') && <ButtonLink variant="ghost" to="/sources/queue"><ListOrdered aria-hidden="true" />{s.job === 'running' ? 'Transcribing… see queue' : 'In the queue'}</ButtonLink>}
          {s.video != null && <ButtonLink to={`/sources/youtube/${s.video}`} title="The whole video, its lines following the voice"><MonitorPlay aria-hidden="true" />Watch the video</ButtonLink>}
          {s.media && (s.kind === 'audio' || s.kind === 'video') && <ButtonLink to={`/sources/${s.id}/cleanup`}><Scissors aria-hidden="true" />Clean up</ButtonLink>}
          {s.story && <ButtonLink to={`/stories?syllabus=${s.story.syllabus}&unit=${s.story.unit}`}><BookAudio aria-hidden="true" />Another story</ButtonLink>}
          {s.status !== 'kept' && <Button variant={s.sentences.length ? undefined : 'primary'} onClick={() => status('kept')}><Check aria-hidden="true" />Keep</Button>}
          {s.sentences.length > 0 && <ButtonLink variant="primary" {...practise.link({ source: s.id })}><Play aria-hidden="true" />Practise all</ButtonLink>}
          {/* filed away: sending it back or archiving it is rare here, so it waits behind the menu */}
          {s.status === 'kept' && <Menu label="More for this source" variant="ghost" icon content={<Ellipsis aria-hidden="true" />}>
            <MenuItem onClick={() => status('inbox')}><InboxIcon aria-hidden="true" />Back to inbox</MenuItem>
            <MenuItem onClick={() => status('archived')}><Archive aria-hidden="true" />Archive</MenuItem>
          </Menu>}
          {s.status === 'inbox' && <Button variant="ghost" onClick={() => status('archived')}><Archive aria-hidden="true" />Archive</Button>}
        </div>
      </header>

      <div className="source-layout">
        <div className="source-aside">
          {/* a screenshot is the source; for audio the waveform is, so no placeholder panel */}
          {s.image && <SourcePanel big kind={s.kind} image={s.image} alt={s.text} />}
          {s.media && <WaveformPlayer source={s} start={null} end={null} noun="source" onTime={onTime} handle={player}
            hint="Click a line's time to play from there."
            controls={timed.length > 0 && <>
              <Button icon aria-label="Previous line" title="Previous line" disabled={!prevLine && at < 0} onClick={() => playFrom(prevLine ?? timed[0])}><SkipBack aria-hidden="true" /></Button>
              <Button icon aria-label="Next line" title="Next line" disabled={!nextLine} onClick={() => nextLine && playFrom(nextLine)}><SkipForward aria-hidden="true" /></Button>
            </>} />}
          {/* what it is and what it holds; on phones it follows the script */}
          <section className="source-about" aria-label="About this source">
            {labels === null ? (
              <div className="chips source-labels">
                {s.category && <Plate>{s.category}</Plate>}
                {s.labels.map((l) => <Chip key={l}>{l}</Chip>)}
                <Button variant="ghost" size="small" onClick={() => setLabels(s.labels.join(', '))}><Pencil aria-hidden="true" />{s.labels.length ? 'Edit labels' : 'Add labels'}</Button>
              </div>
            ) : (
              <form className="edit-line" onSubmit={async (e) => { e.preventDefault(); await action.run(async () => { const next = parseLabels(labels); if (next.length > MAX_LABELS) throw new Error('Use up to three labels. Remove a label and try again.'); set(await api.updateSource(s.id, { labels: next })); setLabels(null) }) }}>
                <label style={{ flex: 1 }}><span className="sr">Labels, comma separated (up to 3)</span>
                  <Input autoFocus value={labels} placeholder="minna no nihongo, lesson 18" onChange={(e) => setLabels(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLabels(null)} /></label>
                <Button variant="primary" size="small">Save</Button>
              </form>
            )}
            {s.story && <StoryPanel s={s} story={s.story} onChange={set} />}
            {s.sentences.length > 0 && <Coverage id={s.id} />}
            <dl className="meta source-facts">
              <dt>Collected</dt><dd>{date}, {clock(s.created_at)}</dd>
              <dt>Status</dt><dd>{{ inbox: 'In the inbox', kept: 'In Sources', archived: 'Archived' }[s.status]}</dd>
              {s.duration && <><dt>Length</dt><dd className="num">{fmtTime(s.duration)}</dd></>}
              {s.lessons.length > 0 && <><dt>{s.lessons.length === 1 ? 'Lesson' : 'Lessons'}</dt><dd className="source-lessons">
                {s.lessons.map(l => <Link key={l.id} to={`/lessons/${l.id}`}><BookOpen aria-hidden="true" />{l.title}{l.done && <span className="sr"> (done)</span>}{l.done && <Check aria-hidden="true" className="source-lesson-done" />}</Link>)}
              </dd></>}
            </dl>
          </section>
        </div>

        <div className="source-content">
        {head?.playing && !follow && current != null && (
          <Button variant="primary" className="follow-voice" onClick={() => setFollow(true)}><ListEnd aria-hidden="true" />Back to the current line</Button>
        )}
        {s.sentences.length > 0 && <div className="aids-bar">
          <ReadingAids aids={aids} roman={s.sentences.some((x) => x.roman)} />
          <div className="aids-bar-end">
            {aids.translation && <TranslateAll sentences={s.sentences} />}
            <DeckPicker small sentenceIds={() => s.sentences.map((x) => x.id)} />
          </div>
        </div>}
        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.sentences.map(x => <SentenceRow key={x.id} x={x} beyond={s.story?.outside?.filter((o) => o.sentence === x.id && x.text.slice(o.start, o.end) === o.surface)} furigana={aids.furigana} roman={aids.roman} translation={aids.translation} audio={!!s.media && x.start != null}
            current={current === x.id} past={head != null && x.end != null && timed.includes(x) && x.end <= head.t && current !== x.id}
            playing={current === x.id && !!head?.playing} follow={!!head?.playing && follow}
            onPlay={() => play(x)} onPlayFrom={() => playFrom(x)} onSaved={(nx) => set((prev) => ({ ...prev, sentences: prev.sentences.map((y) => (y.id === nx.id ? nx : y)) }))}
            onDeleted={() => { set((prev) => ({ ...prev, sentences: prev.sentences.filter((y) => y.id !== x.id) })); stats.refresh() }} />)}
          {!s.sentences.length && <li className="empty"><h2>No sentences yet</h2><p>{s.job ? 'They appear once the audio is transcribed.' : writing ? 'They appear once the story is written and checked.' : 'This source has no text.'}</p></li>}
        </ol>
        </div>
      </div>
      </fieldset>
    </>
  )
}

function SentenceRow({ x, beyond, furigana, roman, translation, audio, current, past, playing, follow, onPlay, onPlayFrom, onSaved, onDeleted }: {
  x: Sentence; beyond?: StoryOutside[]; furigana: boolean; roman: boolean; translation: boolean; audio: boolean; current: boolean; past: boolean; playing: boolean; follow: boolean
  onPlay: () => void; onPlayFrom: () => void; onSaved: (x: Sentence) => void; onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const practise = usePractise()
  const row = useRef<HTMLLIElement>(null)
  // keep the spoken sentence in the upper part of the reading area, so the lines coming next
  // stay visible; only scroll once it drifts out of that band, not on every line
  useEffect(() => {
    const el = row.current
    if (!current || !follow || !el) return
    // wide screens scroll the list itself under a fixed header; narrow ones scroll the window under the docked player
    const list = el.closest('.rows')
    const own = list instanceof HTMLElement && getComputedStyle(list).overflowY !== 'visible'
    const player = document.querySelector('.source-layout .source-audio')
    const top = own ? list.getBoundingClientRect().top : player && getComputedStyle(player).position === 'sticky' ? player.getBoundingClientRect().bottom : 0
    const r = el.getBoundingClientRect(), room = (own ? list.getBoundingClientRect().bottom : window.innerHeight) - top
    if (r.top >= top + room * .1 && r.bottom <= top + room * .7) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scroller: HTMLElement | Window = own ? list : window
    scroller.scrollBy({ top: r.top - (top + room * .25), behavior: calm ? 'auto' : 'smooth' })
  }, [current, follow])
  return (
    <li ref={row} className={'row ' + (audio ? 'row-lead' : 'row-simple') + (current ? ' now' : '') + (past ? ' past' : '')} aria-current={current ? 'true' : undefined}>
      {audio && (
        <div className="lead">
          <Button size="small" icon onClick={onPlay} aria-label={playing ? 'Pause' : `Play this line only (${fmtTime(x.start)})`} title={playing ? 'Pause' : 'Play this line only'} aria-pressed={playing}><Volume2 aria-hidden="true" /></Button>
          <button type="button" className="tc num" onClick={onPlayFrom} aria-label={`Play from ${fmtTime(x.start)}`} title="Play from here">{fmtTime(x.start)}</button>
        </div>
      )}
      <SentenceText>
        <Furigana text={x.text} pairs={x.furigana} show={furigana} marks={beyond?.map((o) => [o.start, o.end])}
          markClass="story-beyond" markTitle={beyond?.length ? 'Not in the syllabus yet, or written there in kana' : undefined} />
        {roman && x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
        {translation && <Translation s={x} onTranslated={onSaved} />}
      </SentenceText>
      {/* the record over the tools, in one narrow column, so the sentence keeps the width */}
      <div className="acts">
        <span className="record"><Stamps stamps={x.stamps} max={3} /></span>
        <span className="tools">
          <ButtonLink variant="ghost" size="small" icon {...practise.link({ sentence: x.id })} aria-label="Practise this sentence" title="Practise this sentence only"><Mic aria-hidden="true" /></ButtonLink>
          <ButtonLink variant="ghost" size="small" icon to={`/sentences/${x.id}`} aria-label="Details" title="Details"><Info aria-hidden="true" /></ButtonLink>
          <CopyButton text={x.text} />
          <Button variant="ghost" size="small" icon aria-label="Edit the text, readings and translation" title="Edit sentence" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
        </span>
      </div>
      {editing && <SentenceEditor sentence={x} onSaved={onSaved} onClose={() => setEditing(false)} onDeleted={onDeleted} />}
    </li>
  )
}

/** What a story was written within and by, how writing it is going, and what it checked. */
function StoryPanel({ s, story, onChange }: { s: Source; story: Story; onChange: (s: Source) => void }) {
  const action = useAction()
  const state = story.state ?? 'done'
  const outside = story.outside ?? []
  const level = outside.filter((o) => o.reason === 'level'), kanji = outside.filter((o) => o.reason === 'kanji')
  const words = (list: StoryOutside[]) => [...new Map(list.map((o) => [o.surface, o])).values()]
  return <section className="story-panel" aria-label="The story">
    {story.title_tr && <p className="story-title-tr">{story.title_tr}</p>}
    <p className="meta" style={{ margin: 0 }}>
      Written for <Link to={`/stories/syllabi/${story.syllabus}`}>{story.unit_name}</Link>
      {story.writer && <> by {story.writer}</>}{story.theme && <>, about “{story.theme}”</>}.
    </p>
    {STORY_BUSY.includes(state) && <p className="meta story-progress" role="status"><LoaderCircle className="loading-spinner" aria-hidden="true" />{STORY_STATE[state]}</p>}
    {state === 'failed' && <div className="story-failed">
      <p className="meta failed story-progress"><TriangleAlert aria-hidden="true" />{story.error || 'Writing this story stopped.'}</p>
      <Button size="small" disabled={action.busy} onClick={() => action.run(async () => { await api.retryStory(s.id); onChange(await api.source(s.id)) })}>
        <RotateCcw aria-hidden="true" />Try again{story.failed_at && story.failed_at !== 'writing' ? ` from ${STORY_STATE[story.failed_at].replace('…', '').toLowerCase()}` : ''}
      </Button>
      {action.error != null && <ErrorNotice error={action.error} />}
    </div>}
    {state === 'done' && story.checked === false && <p className="meta">Its words weren't checked: the syllabus has no word lists, or kotoba can't read Japanese words on this machine.</p>}
    {level.length > 0 && <p className="meta" style={{ margin: 0 }}>Beyond the syllabus, marked in the text: {words(level).map((o, i) => <span key={o.surface}>{i > 0 && '、'}<span lang="ja">{o.surface}</span></span>)}</p>}
    {kanji.length > 0 && <p className="meta" style={{ margin: 0 }}>Studied in kana: {words(kanji).map((o, i) => <span key={o.surface}>{i > 0 && '、'}<span lang="ja">{o.surface}</span> ({o.kana})</span>)}</p>}
    {state === 'done' && story.checked && !outside.length && <p className="meta" style={{ margin: 0 }}><Check aria-hidden="true" className="story-ok" />Every word is in the syllabus{story.repaired ? ` (the writer fixed ${story.repaired} line${story.repaired === 1 ? '' : 's'})` : ''}.</p>}
    {!!story.grammar?.length && <details className="story-grammar">
      <summary className="meta">Grammar it uses</summary>
      <ul>{story.grammar.map((g) => <li key={g.pattern}><span lang="ja">{g.pattern}</span>{g.lines.length > 0 && <span className="meta num"> · line{g.lines.length > 1 ? 's' : ''} {g.lines.join(', ')}</span>}</li>)}</ul>
    </details>}
  </section>
}

/** How much of the source's vocabulary you have, and the new words that come up most in it. */
function Coverage({ id }: { id: number }) {
  const { data: c, reload } = useAsync(() => api.sourceWords(id), [id])
  useIndexWait(c && c.waiting ? { ...c, pending: Math.max(1, c.pending) } : c, reload)
  if (!c || (!c.words && !c.waiting)) return null
  const have = c.known + c.practised
  const pct = (n: number) => `${c.words ? (n / c.words) * 100 : 0}%`
  return <section className="source-coverage" aria-label="Its words">
    <p className="meta" style={{ margin: 0 }}>
      {c.waiting ? 'Finding its words…' : <><Link to="/words"><b className="num">{c.words} words</b></Link>
        <span className="num"> · you have {have} ({Math.round(have / Math.max(1, c.words) * 100)}%)</span></>}
    </p>
    {!c.waiting && <span className="bar" role="img" aria-label={`${c.known} known, ${c.practised} practised, ${c.new} new`}>
      <i className="known" style={{ width: pct(c.known) }} /><i className="practised" style={{ width: pct(c.practised) }} />
    </span>}
    {c.top_new.length > 0 && <p className="meta" style={{ margin: 0 }}>New here: {c.top_new.map((w, i) => <span key={w.id}>{i > 0 && '、'}
      <Link to={`/words/${w.id}`} lang="ja">{w.lemma}</Link></span>)}</p>}
  </section>
}
