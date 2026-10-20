import { BookOpen, ChevronLeft, Play, Volume2, Pencil, Check, Archive, Inbox as InboxIcon, Scissors, SkipBack, SkipForward, ListEnd, ListOrdered } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Sentence, type Source } from '../lib/api'
import { useIndexWait } from '../lib/wordIndex'
import { stopAudio } from '../lib/audio'
import { WaveformPlayer, type PlayerHandle } from '../components/SentenceAudio'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SentenceEditor } from '../components/SentenceEditor'
import { MAX_LABELS, parseLabels } from '../lib/labels'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, Skeleton, clock, dayLabel, useAsync, useToast, useAction } from '../components/ui'
import { ReadingAids, TranslateAll, Translation, useAids } from '../components/ReadingAids'
import { CopyButton } from './Library'
import { useBackTo } from '../lib/trail'
import { Button, ButtonLink, Chip, Input, Plate } from '../components/ds'

export default function SourcePage() {
  const id = Number(useParams().id)
  return <SourcePageDetail key={id} id={id} />
}

function SourcePageDetail({ id }: { id: number }) {
  const { data: s, error, set, reload } = useAsync(() => api.source(id), [id])
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
  useEffect(() => () => stopAudio(), [id])
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
      <header className="page-head">
        <ButtonLink variant="ghost" icon to={backTo ?? (s.status === 'inbox' ? '/inbox' : '/sources')} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <h1>{s.title || (s.kind === 'capture' ? 'Capture' : 'Source')} <span className="meta num">{{ capture: 'Capture', audio: 'Audio', video: 'Video', subtitle: 'Subtitles', text: 'Text' }[s.kind]} · {s.sentences.length} sentences</span></h1>
        <span className="grow" />
        {s.status !== 'kept' && <Button onClick={() => status('kept')}><Check aria-hidden="true" />Keep</Button>}
        {s.status === 'kept' && <Button variant="ghost" onClick={() => status('inbox')}><InboxIcon aria-hidden="true" />Back to inbox</Button>}
        {s.status !== 'archived' && <Button variant="ghost" onClick={() => status('archived')}><Archive aria-hidden="true" />Archive</Button>}
        {(s.job === 'waiting' || s.job === 'running') && <ButtonLink to="/sources/queue"><ListOrdered aria-hidden="true" />{s.job === 'running' ? 'Transcribing… see queue' : 'In the queue'}</ButtonLink>}
        {s.media && (s.kind === 'audio' || s.kind === 'video') && <ButtonLink to={`/sources/${s.id}/cleanup`}><Scissors aria-hidden="true" />Clean up</ButtonLink>}
        {s.sentences.length > 0 && <DeckPicker sentenceIds={() => s.sentences.map((x) => x.id)} />}
        {s.sentences.length > 0 && <ButtonLink variant="primary" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise all</ButtonLink>}
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
          <dl className="meta" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}>
            <dt>Collected</dt><dd style={{ margin: 0 }}>{date}, {clock(s.created_at)}</dd>
            <dt>Status</dt><dd style={{ margin: 0 }}>{{ inbox: 'In the inbox', kept: 'In Sources', archived: 'Archived' }[s.status]}</dd>
            {s.duration && <><dt>Length</dt><dd style={{ margin: 0 }} className="num">{fmtTime(s.duration)}</dd></>}
            {s.lessons.length > 0 && <><dt>{s.lessons.length === 1 ? 'Lesson' : 'Lessons'}</dt><dd style={{ margin: 0 }} className="source-lessons">
              {s.lessons.map(l => <Link key={l.id} to={`/lessons/${l.id}`}><BookOpen aria-hidden="true" />{l.title}{l.done && <span className="sr"> (done)</span>}{l.done && <Check aria-hidden="true" className="source-lesson-done" />}</Link>)}
            </dd></>}
          </dl>
          {s.sentences.length > 0 && <Coverage id={s.id} />}
          <div style={{ display: 'grid', gap: 8 }}>
            {labels === null ? (
              <div className="chips" style={{ alignItems: 'center' }}>
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
          </div>
        </div>

        <div className="source-content">
        {head?.playing && !follow && current != null && (
          <Button variant="primary" className="follow-voice" onClick={() => setFollow(true)}><ListEnd aria-hidden="true" />Back to the current line</Button>
        )}
        {s.sentences.length > 0 && <div className="aids-bar">
          <ReadingAids aids={aids} roman={s.sentences.some((x) => x.roman)} />
          {aids.translation && <TranslateAll sentences={s.sentences} />}
        </div>}
        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.sentences.map(x => <SentenceRow key={x.id} x={x} furigana={aids.furigana} roman={aids.roman} translation={aids.translation} audio={!!s.media && x.start != null}
            current={current === x.id} past={head != null && x.end != null && timed.includes(x) && x.end <= head.t && current !== x.id}
            playing={current === x.id && !!head?.playing} follow={!!head?.playing && follow}
            onPlay={() => play(x)} onPlayFrom={() => playFrom(x)} onSaved={(nx) => set((prev) => ({ ...prev, sentences: prev.sentences.map((y) => (y.id === nx.id ? nx : y)) }))} />)}
          {!s.sentences.length && <li className="empty"><h2>No sentences yet</h2><p>{s.job ? 'They appear once the audio is transcribed.' : 'This source has no text.'}</p></li>}
        </ol>
        </div>
      </div>
      </fieldset>
    </>
  )
}

function SentenceRow({ x, furigana, roman, translation, audio, current, past, playing, follow, onPlay, onPlayFrom, onSaved }: {
  x: Sentence; furigana: boolean; roman: boolean; translation: boolean; audio: boolean; current: boolean; past: boolean; playing: boolean; follow: boolean
  onPlay: () => void; onPlayFrom: () => void; onSaved: (x: Sentence) => void
}) {
  const [editing, setEditing] = useState(false)
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
        <Furigana text={x.text} pairs={x.furigana} show={furigana} />
        {roman && x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
        {translation && <Translation s={x} onTranslated={onSaved} />}
      </SentenceText>
      {editing && <SentenceEditor sentence={x} onSaved={onSaved} onClose={() => setEditing(false)} />}
      <div className="acts">
        <ButtonLink variant="ghost" size="small" to={`/practice?sentence=${x.id}&from=source`} title="Practise this sentence only"><Play aria-hidden="true" />Practise</ButtonLink>
        <ButtonLink variant="ghost" size="small" to={`/sentences/${x.id}`}>Details</ButtonLink>
        <CopyButton text={x.text} />
        <Button variant="ghost" size="small" icon aria-label="Edit the text, readings and translation" title="Edit sentence" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
        <span className="record"><Stamps stamps={x.stamps} max={3} /></span>
      </div>
    </li>
  )
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
