import { ChevronLeft, Play, Volume2, Pencil, Check, Archive, Inbox as InboxIcon, Scissors, SkipBack, SkipForward, ListEnd } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Sentence, type Source } from '../lib/api'
import { stopAudio } from '../lib/audio'
import { WaveformPlayer, type PlayerHandle } from '../components/SentenceAudio'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { MAX_LABELS, parseLabels } from '../lib/labels'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { DeckPicker } from '../components/DeckPicker'
import { ErrorNotice, Skeleton, clock, dayLabel, useAsync, usePref, useToast, useAction } from '../components/ui'
import { CopyButton } from './Library'

export default function SourcePage() {
  const id = Number(useParams().id)
  return <SourcePageDetail key={id} id={id} />
}

function SourcePageDetail({ id }: { id: number }) {
  const { data: s, error, set, reload } = useAsync(() => api.source(id), [id])
  const [furigana] = usePref('furigana', true)
  const [roman] = usePref('roman', false)
  const player = useRef<PlayerHandle>(null)
  // the playhead, once playback has started: it lights up the sentence being spoken
  const [head, setHead] = useState<{ t: number; playing: boolean } | null>(null)
  const onTime = useCallback((t: number, playing: boolean) => setHead((h) => (playing || h ? { t, playing } : h)), [])
  // the script follows the voice until the reader scrolls away on their own; one tap brings it back
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    // scrolling the player column or dragging across the waveform isn't leaving the script
    const away = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('.source-aside'))) setFollow(false) }
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
  if (error) return <ErrorNotice error={error} action={<button className="btn" onClick={reload}>Try again</button>} />
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
  const status = async (st: Source['status']) => action.run(async () => { set(await api.updateSource(s.id, { status: st })); toast({ text: st === 'kept' ? 'Moved to the library' : st === 'archived' ? 'Archived' : 'Back in the inbox' }) })
  const { date } = dayLabel(s.created_at)

  return (
    <>
      {action.error != null && <ErrorNotice error={action.error} />}
      <fieldset className="action-scope" disabled={action.busy} aria-busy={action.busy}>
      <header className="page-head">
        <Link className="btn icon ghost" to={s.status === 'inbox' ? '/inbox' : '/library'} aria-label="Back"><ChevronLeft aria-hidden="true" /></Link>
        <h1>{s.title || (s.kind === 'capture' ? 'Capture' : 'Source')} <span className="meta num">{{ capture: 'Capture', audio: 'Audio', video: 'Video', subtitle: 'Subtitles', text: 'Text' }[s.kind]} · {s.sentences.length} sentences</span></h1>
        <span className="grow" />
        {s.status !== 'kept' && <button className="btn" onClick={() => status('kept')}><Check aria-hidden="true" />Keep</button>}
        {s.status === 'kept' && <button className="btn ghost" onClick={() => status('inbox')}><InboxIcon aria-hidden="true" />Back to inbox</button>}
        {s.status !== 'archived' && <button className="btn ghost" onClick={() => status('archived')}><Archive aria-hidden="true" />Archive</button>}
        {s.media && (s.kind === 'audio' || s.kind === 'video') && <Link className="btn" to={`/recordings/${s.id}`}><Scissors aria-hidden="true" />Clean up</Link>}
        {s.sentences.length > 0 && <DeckPicker sentenceIds={() => s.sentences.map((x) => x.id)} />}
        {s.sentences.length > 0 && <Link className="btn primary" to={`/practice?source=${s.id}`}><Play aria-hidden="true" />Practise all</Link>}
      </header>

      <div className="source-layout">
        <div className="source-aside">
          {/* a screenshot is the source; for audio the waveform is, so no placeholder panel */}
          {s.image && <SourcePanel big kind={s.kind} image={s.image} alt={s.text} />}
          {s.media && <WaveformPlayer source={s} start={null} end={null} noun="source" onTime={onTime} handle={player}
            hint="Click a line's time to play from there."
            controls={timed.length > 0 && <>
              <button className="btn icon" aria-label="Previous line" title="Previous line" disabled={!prevLine && at < 0} onClick={() => playFrom(prevLine ?? timed[0])}><SkipBack aria-hidden="true" /></button>
              <button className="btn icon" aria-label="Next line" title="Next line" disabled={!nextLine} onClick={() => nextLine && playFrom(nextLine)}><SkipForward aria-hidden="true" /></button>
            </>} />}
          <dl className="meta" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}>
            <dt>Collected</dt><dd style={{ margin: 0 }}>{date}, {clock(s.created_at)}</dd>
            <dt>Status</dt><dd style={{ margin: 0 }}>{{ inbox: 'In the inbox', kept: 'In the library', archived: 'Archived' }[s.status]}</dd>
            {s.duration && <><dt>Length</dt><dd style={{ margin: 0 }} className="num">{fmtTime(s.duration)}</dd></>}
          </dl>
          <div style={{ display: 'grid', gap: 8 }}>
            {labels === null ? (
              <div className="chips" style={{ alignItems: 'center' }}>
                {s.category && <span className="plate">{s.category}</span>}
                {s.labels.map((l) => <span key={l} className="chip">{l}</span>)}
                <button className="btn small ghost" onClick={() => setLabels(s.labels.join(', '))}><Pencil aria-hidden="true" />{s.labels.length ? 'Edit labels' : 'Add labels'}</button>
              </div>
            ) : (
              <form className="edit-line" onSubmit={async (e) => { e.preventDefault(); await action.run(async () => { const next = parseLabels(labels); if (next.length > MAX_LABELS) throw new Error('Use up to three labels. Remove a label and try again.'); set(await api.updateSource(s.id, { labels: next })); setLabels(null) }) }}>
                <label style={{ flex: 1 }}><span className="sr">Labels, comma separated (up to 3)</span>
                  <input className="input" autoFocus value={labels} placeholder="minna no nihongo, lesson 18" onChange={(e) => setLabels(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLabels(null)} /></label>
                <button className="btn small primary">Save</button>
              </form>
            )}
          </div>
        </div>

        <div className="source-content">
        {head?.playing && !follow && current != null && (
          <button className="btn primary follow-voice" onClick={() => setFollow(true)}><ListEnd aria-hidden="true" />Back to the current line</button>
        )}
        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.sentences.map(x => <SentenceRow key={x.id} x={x} furigana={furigana} roman={roman} audio={!!s.media && x.start != null}
            current={current === x.id} past={head != null && x.end != null && timed.includes(x) && x.end <= head.t && current !== x.id}
            playing={current === x.id && !!head?.playing} follow={!!head?.playing && follow}
            onPlay={() => play(x)} onPlayFrom={() => playFrom(x)} onSaved={(nx) => set({ ...s, sentences: s.sentences.map((y) => (y.id === nx.id ? nx : y)) })} />)}
          {!s.sentences.length && <li className="empty"><h2>No sentences yet</h2><p>{s.job ? 'They appear once the audio is transcribed.' : 'This source has no text.'}</p></li>}
        </ol>
        </div>
      </div>
      </fieldset>
    </>
  )
}

function SentenceRow({ x, furigana, roman, audio, current, past, playing, follow, onPlay, onPlayFrom, onSaved }: {
  x: Sentence; furigana: boolean; roman: boolean; audio: boolean; current: boolean; past: boolean; playing: boolean; follow: boolean
  onPlay: () => void; onPlayFrom: () => void; onSaved: (x: Sentence) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const action = useAction()
  const row = useRef<HTMLLIElement>(null)
  // keep the spoken sentence in the upper part of the reading area, so the lines coming next
  // stay visible; only scroll once it drifts out of that band, not on every line
  useEffect(() => {
    const el = row.current
    if (!current || !follow || !el) return
    const player = document.querySelector('.source-layout .source-audio')
    const top = player && getComputedStyle(player).position === 'sticky' ? player.getBoundingClientRect().bottom : 0
    const r = el.getBoundingClientRect(), room = window.innerHeight - top
    if (r.top >= top + room * .1 && r.bottom <= top + room * .7) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollBy({ top: r.top - (top + room * .25), behavior: calm ? 'auto' : 'smooth' })
  }, [current, follow])
  return (
    <li ref={row} className={'row ' + (audio ? 'row-lead' : 'row-simple') + (current ? ' now' : '') + (past ? ' past' : '')} aria-current={current ? 'true' : undefined}>
      {audio && (
        <div className="lead">
          <button className="btn small icon" onClick={onPlay} aria-label={playing ? 'Pause' : `Play this line only (${fmtTime(x.start)})`} title={playing ? 'Pause' : 'Play this line only'} aria-pressed={playing}><Volume2 aria-hidden="true" /></button>
          <button type="button" className="tc num" onClick={onPlayFrom} aria-label={`Play from ${fmtTime(x.start)}`} title="Play from here">{fmtTime(x.start)}</button>
        </div>
      )}
      {draft !== null ? (
        <form className="edit-line" onSubmit={async (e) => { e.preventDefault(); if (draft.trim()) await action.run(async () => { onSaved(await api.updateSentence(x.id, { text: draft })); setDraft(null) }) }}>
          <label style={{ flex: 1 }}><span className="sr">Sentence text</span>
            <input className="input" lang="ja" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setDraft(null)} /></label>
          <button className="btn small primary" disabled={action.busy || !draft.trim()}>Save</button>
          <button type="button" className="btn small ghost" disabled={action.busy} onClick={() => setDraft(null)}>Cancel</button>
          {action.error != null && <ErrorNotice error={action.error} />}
        </form>
      ) : (
        <SentenceText>
          <Furigana text={x.text} pairs={x.furigana} show={furigana} />
          {roman && x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
        </SentenceText>
      )}
      <div className="acts">
        <Link className="btn small ghost" to={`/sentences/${x.id}`}>Details</Link>
        <Stamps stamps={x.stamps} max={3} />
        <CopyButton text={x.text} />
        <button className="btn small icon ghost" aria-label="Fix the text" title="Fix the text" onClick={() => setDraft(x.text)}><Pencil aria-hidden="true" /></button>
      </div>
    </li>
  )
}
