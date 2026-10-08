import { AudioLines, ListEnd, LoaderCircle, Pause, Play, Repeat1, SkipBack, SkipForward } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Lesson, type LessonFile, type Sentence, type Source } from '../lib/api'
import { Furigana } from './Furigana'
import { ReadingAids, Translation, useAids } from './ReadingAids'
import { ErrorNotice, shortcutBlocked, useAction, useAsync, usePref } from './ui'

/** Something to listen to: a recording kept with the lesson (its transcript is the source
 *  made from it, once transcribed) or a linked library source that has audio of its own. */
export type Track = { key: string; name: string; url: string; video: boolean; file: LessonFile | null; source: number | null; job: Source['job'] | null; error: string }

export function lessonTracks(l: Lesson): Track[] {
  const fromFiles = l.files.filter(f => f.kind === 'audio' || f.kind === 'video').map(f => ({
    key: `f${f.id}`, name: f.name.replace(/\.[^.]+$/, ''), url: f.url, video: f.kind === 'video', file: f, source: f.source, job: f.job, error: f.job_error,
  }))
  const fromSources = l.sources.filter(s => s.media && !l.files.some(f => f.source === s.id)).map(s => ({
    key: `s${s.id}`, name: s.title, url: s.media!, video: s.kind === 'video', file: null, source: s.id, job: s.job, error: '',
  }))
  return [...fromFiles, ...fromSources]
}

const pending = (job: Track['job']) => job === 'waiting' || job === 'running'
const clockTime = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** The lesson's recordings, one at a time: a small player, and the transcript under it following the voice. */
export function Listen({ l, tracks, onChange }: { l: Lesson; tracks: Track[]; onChange: (l: Lesson) => void }) {
  const [key, setKey] = usePref(`lesson-${l.id}-track`, tracks[0].key)
  const i = Math.max(0, tracks.findIndex(t => t.key === key))
  const track = tracks[i]
  return (
    <section className="listen" aria-label="Listen">
      <div className="listen-head">
        <AudioLines aria-hidden="true" />
        {tracks.length > 1 ? <>
          <label className="listen-pick"><span className="sr">Recording</span>
            <select className="select" lang="ja" value={track.key} onChange={e => setKey(e.target.value)}>
              {tracks.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select></label>
          <span className="meta num">{i + 1} of {tracks.length}</span>
        </> : <h2 className="listen-name" lang="ja">{track.name}</h2>}
      </div>
      <Player key={track.key} l={l} track={track} onChange={onChange}
        onNextTrack={i + 1 < tracks.length ? () => setKey(tracks[i + 1].key) : undefined} />
    </section>
  )
}

function Player({ l, track, onChange, onNextTrack }: { l: Lesson; track: Track; onChange: (l: Lesson) => void; onNextTrack?: () => void }) {
  const media = useRef<HTMLMediaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [speed, setSpeed] = usePref('lesson-speed', 1)
  const [repeat, setRepeat] = useState(false)
  const [loopLine, setLoopLine] = useState(-1)
  const [follow, setFollow] = useState(true)
  const aids = useAids()
  const waiting = pending(track.job)
  const script = useAsync(() => track.source && !waiting ? api.source(track.source) : Promise.resolve(null), [track.source, waiting])
  const lines = useMemo(() => (script.data?.sentences ?? []).filter(x => x.start != null && x.end != null), [script.data])
  // the line being spoken, or the last one begun: the pause after a line still belongs to it
  const at = lines.findLastIndex(x => x.start! <= time + .05)

  // the playhead moves every frame while playing; a repeated line loops back to its start
  const loop = useRef<[number, number] | null>(null)
  useEffect(() => {
    const line = lines[loopLine]
    loop.current = repeat && line ? [line.start!, line.end!] : null
    if (media.current) media.current.loop = repeat && !lines.length
  }, [repeat, loopLine, lines])
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const a = media.current
      if (a) {
        const r = loop.current
        if (r && (a.currentTime >= r[1] || a.currentTime < r[0] - .25)) a.currentTime = r[0]
        setTime(a.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])
  useEffect(() => { if (media.current) media.current.playbackRate = speed }, [speed])

  const seek = useCallback((t: number) => {
    const a = media.current
    if (!a) return
    a.currentTime = Math.max(0, Math.min(a.duration || t, t))
    setTime(a.currentTime)
  }, [])
  const play = () => { void media.current?.play().catch(() => setFailed(true)) }
  const toggle = () => { if (media.current?.paused) play(); else media.current?.pause() }
  // a repeated line moves with you: wherever you go, the line there is the one that repeats
  const loopAt = useCallback((i: number) => {
    setLoopLine(i)
    if (loop.current && lines[i]) loop.current = [lines[i].start!, lines[i].end!]
  }, [lines])
  const goToLine = useCallback((i: number) => {
    const line = lines[i]
    if (!line) return
    setFollow(true)
    loopAt(i)
    seek(line.start!)
  }, [lines, seek, loopAt])
  const playLine = useCallback((i: number) => {
    if (!lines[i]) return
    goToLine(i)
    void media.current?.play().catch(() => setFailed(true))
  }, [lines, goToLine])
  // back restarts the line you're in, unless you're just past its start, like a music player;
  // it only moves the playhead, so a paused player stays paused
  const prev = () => lines.length ? goToLine(at >= 0 && time - lines[at].start! > 1.5 ? at : Math.max(0, at - 1)) : seek(time - 5)
  const next = () => lines.length ? playLine(Math.min(lines.length - 1, at + 1)) : seek(time + 5)
  const toggleRepeat = () => { setRepeat(!repeat); setLoopLine(Math.max(0, at)) }

  const keys = useRef({ toggle, prev, next, toggleRepeat })
  useEffect(() => { keys.current = { toggle, prev, next, toggleRepeat } })
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return
      const k = keys.current
      if (e.code === 'Space') { e.preventDefault(); k.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); k.prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); k.next() }
      else if (e.key === 'r' || e.key === 'R') k.toggleRepeat()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // keep the spoken line in the upper part of the transcript, unless the reader scrolled away
  useEffect(() => {
    const box = scroller.current
    const el = box?.querySelector<HTMLElement>(`[data-line="${at}"]`)
    if (!box || !el || !follow || !playing) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    if (r.top >= b.top + b.height * .08 && r.bottom <= b.top + b.height * .65) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollBy({ top: r.top - (b.top + b.height * .2), behavior: calm ? 'auto' : 'smooth' })
  }, [at, follow, playing])

  const onTranslated = useCallback((x: Sentence) => script.set(prev => prev && ({ ...prev, sentences: prev.sentences.map(y => y.id === x.id ? x : y) })), [script])
  const span = duration || lines.at(-1)?.end || 0
  const pct = (t: number) => `${span ? Math.min(100, t / span * 100) : 0}%`
  const ready = duration > 0 && !failed
  const props = {
    ref: media as never, src: track.url, preload: 'metadata',
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = speed },
    onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
    onEnded: () => { setPlaying(false); setTime(media.current?.duration ?? 0) },
    onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) => setTime(e.currentTarget.currentTime),
    onError: () => { setFailed(true); setPlaying(false) },
  }

  return <>
    {track.video ? <video className="listen-video" playsInline {...props} /> : <audio {...props} />}

    <div className="listen-deck">
      <div className="listen-rail" data-lines={lines.length > 0 || undefined}>
        {lines.length > 0
          ? lines.map((x, i) => <i key={x.id} data-state={i === at ? 'now' : i < at ? 'past' : undefined} data-loop={repeat && i === loopLine || undefined}
              style={{ left: pct(x.start!), width: `calc(${pct(x.end! - x.start!)} - 1px)` }} />)
          : <i className="listen-fill" style={{ width: pct(time) }} />}
        <b className="listen-playhead" style={{ left: pct(time) }} aria-hidden="true" />
        <input type="range" min={0} max={span || 1} step={.1} value={Math.min(time, span || 0)} disabled={!ready}
          aria-label="Seek" aria-valuetext={`${clockTime(time)} of ${clockTime(span)}`}
          onChange={e => { const t = Number(e.target.value); setFollow(true); loopAt(Math.max(0, lines.findLastIndex(x => x.start! <= t + .05))); seek(t) }} onKeyDown={e => { if (e.code === 'Space') { e.preventDefault(); toggle() } }} />
      </div>
      <div className="listen-times num" aria-hidden="true"><span>{clockTime(time)}</span><span>{lines.length > 0 && at >= 0 ? `line ${at + 1} of ${lines.length}` : ''}</span><span>{clockTime(span)}</span></div>
      <div className="listen-transport">
        <button className="btn icon ghost" disabled={!ready} onClick={prev} aria-label={lines.length ? 'Previous line' : 'Back 5 seconds'} title={lines.length ? 'Previous line (←)' : 'Back 5 seconds (←)'}><SkipBack aria-hidden="true" /></button>
        <button className="btn icon primary listen-play" disabled={!ready} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
        <button className="btn icon ghost" disabled={!ready} onClick={next} aria-label={lines.length ? 'Next line' : 'Forward 5 seconds'} title={lines.length ? 'Next line (→)' : 'Forward 5 seconds (→)'}><SkipForward aria-hidden="true" /></button>
        <span className="grow" />
        <button className="btn small ghost listen-repeat" aria-pressed={repeat} disabled={!ready} onClick={toggleRepeat} title={lines.length ? 'Repeat the current line (R)' : 'Repeat the recording (R)'}>
          <Repeat1 aria-hidden="true" />{lines.length ? 'Repeat line' : 'Repeat'}</button>
        <label className="listen-speed"><span className="sr">Speed</span>
          <select className="select" value={speed} title="Speed" onChange={e => setSpeed(Number(e.target.value))}>
            {[0.5, 0.75, 0.9, 1, 1.25].map(r => <option key={r} value={r}>{r}×</option>)}
          </select></label>
      </div>
      {failed && <p className="meta" role="alert">This recording couldn’t be played here. <a href={track.url} target="_blank" rel="noreferrer">Open it in a new tab</a>, or check that it’s still in kotoba’s data folder.</p>}
    </div>

    <div className="listen-script" ref={scroller} onWheel={() => playing && setFollow(false)} onTouchMove={() => playing && setFollow(false)}>
      {lines.length > 0 ? <>
        <div className="listen-aids"><ReadingAids aids={aids} roman={lines.some(x => x.roman)} /></div>
        <ol className="listen-lines">
          {lines.map((x, i) => <Line key={x.id} x={x} i={i} state={i === at ? 'now' : i < at ? 'past' : ''}
            furigana={aids.furigana} roman={aids.roman} translation={aids.translation} onPlay={playLine} onTranslated={onTranslated} />)}
        </ol>
        {at === lines.length - 1 && !playing && time > 0 && onNextTrack && <button className="btn small listen-next" onClick={onNextTrack}><SkipForward aria-hidden="true" />Next recording</button>}
      </> : <NoTranscript l={l} track={track} loading={script.loading && !!track.source && !waiting} error={script.error} empty={!!script.data} onChange={onChange} />}
      {playing && !follow && at >= 0 && <button className="btn small primary listen-follow" onClick={() => setFollow(true)}><ListEnd aria-hidden="true" />Back to the current line</button>}
    </div>
    <p className="meta listen-keys">Space: play / pause · ← →: {lines.length ? 'previous / next line' : '5 seconds'} · R: repeat</p>
  </>
}

const Line = memo(function Line({ x, i, state, furigana, roman, translation, onPlay, onTranslated }: {
  x: Sentence; i: number; state: 'now' | 'past' | ''; furigana: boolean; roman: boolean; translation: boolean
  onPlay: (i: number) => void; onTranslated: (x: Sentence) => void
}) {
  return (
    <li data-line={i} data-state={state || undefined} aria-current={state === 'now' ? 'true' : undefined}>
      <button type="button" className="tc num" onClick={() => onPlay(i)} aria-label={`Play from ${clockTime(x.start!)}`} title="Play from here">{clockTime(x.start!)}</button>
      <div className="listen-text" lang="ja">
        <Furigana text={x.text} pairs={x.furigana} show={furigana} />
        {roman && x.roman && <span className="roman">{x.roman.split('\t')[0]}</span>}
        {translation && <Translation s={x} onTranslated={onTranslated} />}
      </div>
    </li>
  )
})

/** Why there is no transcript yet, and the one thing to do about it. */
function NoTranscript({ l, track, loading, error, empty, onChange }: {
  l: Lesson; track: Track; loading: boolean; error: unknown; empty: boolean; onChange: (l: Lesson) => void
}) {
  const action = useAction()
  const transcribe = () => action.run(async () => { onChange(await api.transcribeLessonFile(l.id, track.file!.id)) })
  if (loading) return <div className="listen-state"><LoaderCircle className="spin" aria-hidden="true" /><p>Loading the transcript…</p></div>
  if (error) return <div className="listen-state"><ErrorNotice error={error} /></div>
  if (pending(track.job)) return (
    <div className="listen-state" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p><b>{track.job === 'running' ? 'Transcribing…' : 'Waiting to be transcribed'}</b><br />
        <span className="meta">{track.job === 'running' ? 'The transcript appears here when it’s ready. You can listen meanwhile.' : l.can_transcribe ? 'It’s next in the queue.' : 'It starts once the speech engine is installed. See Add-ons.'}</span></p>
    </div>
  )
  if (track.job === 'failed') return (
    <div className="listen-state">
      <p><b>Transcribing didn’t work</b><br /><span className="meta">{track.error || 'The speech engine stopped on this recording.'}</span></p>
      {action.error != null && <ErrorNotice error={action.error} />}
      {track.file && <button className="btn small" disabled={action.busy} onClick={transcribe}>Try again</button>}
    </div>
  )
  if (empty || !track.file) return (
    <div className="listen-state"><p><b>No lines in this transcript</b><br /><span className="meta">Nothing was heard, or the lines have no times. <Link to={`/sources/${track.source}`}>Open the source</Link> to check.</span></p></div>
  )
  return (
    <div className="listen-state">
      <p><b>No transcript yet</b><br /><span className="meta">{l.can_transcribe
        ? 'kotoba writes out what’s said, line by line, on this machine. The transcript is also kept in your library, so you can practise its sentences.'
        : 'Install the speech engine in Add-ons to write out what’s said, line by line.'}</span></p>
      {action.error != null && <ErrorNotice error={action.error} />}
      {l.can_transcribe
        ? <button className="btn primary" disabled={action.busy} aria-busy={action.busy} onClick={transcribe}>{action.busy ? 'Starting…' : 'Transcribe'}</button>
        : <Link className="btn" to="/addons">Open Add-ons</Link>}
    </div>
  )
}
