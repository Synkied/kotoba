import { AudioLines, BookmarkPlus, Check, ChevronLeft, ExternalLink, LayoutGrid, List, ListEnd, LoaderCircle, Pause, Play, Repeat1, Settings2, SkipBack, SkipForward } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type HeardVideoDetail, type HeardVideoRow, type VideoLine } from '../lib/api'
import { Furigana } from '../components/Furigana'
import { plain } from '../components/Heard'
import { clockTime } from '../components/LessonListen'
import { SourcesTabs } from '../components/SourcesTabs'
import { ErrorNotice, PageHome, SearchBox, Skeleton, shortcutBlocked, useAsync, usePref, useToast } from '../components/ui'
import { Button, ButtonLink, ChipButton, EmptyState, Plate, Segmented, Select, buttonClass } from '../components/ds'
import { useBackTo } from '../lib/trail'
import { useStats } from '../App'

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const PAGE = 30
type View = 'grid' | 'list'
const day = (d: string) => new Date(d + 'T00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** The videos with Japanese subtitles of the channels you follow, newest first: open one to watch
 *  it with its lines beside it. */
export default function YouTubePage() {
  const [params, setParams] = useSearchParams()
  const channel = params.get('channel') ?? ''
  const q = params.get('q') ?? ''
  const list = useAsync(() => api.heardVideos(channel, q, 0, PAGE), [channel, q])
  // "Show more" pages, for the channel and search they were asked for
  const asked = channel + '\n' + q
  const [extra, setExtra] = useState<{ asked: string; rows: HeardVideoRow[] }>({ asked, rows: [] })
  const [more, setMore] = useState(false)
  const d = list.data
  const shown = d ? [...d.videos, ...(extra.asked === asked ? extra.rows : [])] : []
  const set = (key: 'channel' | 'q', value: string) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (value) next.set(key, value); else next.delete(key)
    return next
  }, { replace: true })
  const pick = (c: string) => set('channel', c)
  const [view, setView] = usePref<View>('video-view', 'grid')

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/sources/youtube">YouTube</PageHome> {d?.enabled && <span className="meta num">{plural(d.total, 'video')}</span>}</h1>
        <span className="grow" />
        {d?.enabled && <div className="search"><SearchBox value={q} onChange={(v) => set('q', v)} placeholder="A title, a channel, or something said" /></div>}
        {d?.enabled && <ButtonLink variant="ghost" to="/addons#youtube" title="Follow channels, or stop following them"><Settings2 aria-hidden="true" />Channels</ButtonLink>}
      </header>
      <SourcesTabs />

      {list.error != null && <ErrorNotice error={list.error} />}
      {!d && list.error == null && <Skeleton rows={5} />}
      {d && !d.enabled && (
        <EmptyState>
          <h2>Watch YouTube with its subtitles</h2>
          <p>Follow channels with Japanese subtitles written by people, and each of their videos plays here with its lines beside it, following the voice. Tap a word to look it up; keep a line to practise it.</p>
          <ButtonLink variant="primary" to="/addons#youtube">Set up YouTube listening</ButtonLink>
        </EmptyState>
      )}
      {d?.enabled && <>
        <div className="video-tools">
          {(d.channels.length > 1 || d.found > 0) && <div className="video-channels" role="group" aria-label="Channel">
            <ChipButton type="button" aria-pressed={!channel} onClick={() => pick('')}>All</ChipButton>
            {d.channels.map((c) => <ChipButton key={c.id} type="button" aria-pressed={channel === String(c.id)} onClick={() => pick(String(c.id))}>
              {plain(c.title)} <span className="num">{c.videos}</span></ChipButton>)}
            {d.found > 0 && <ChipButton type="button" aria-pressed={channel === 'found'} onClick={() => pick('found')}
              title="Videos found by Find more on a word’s page">Found with Find more <span className="num">{d.found}</span></ChipButton>}
          </div>}
          {shown.length > 0 && <Segmented name="video-view" role="radiogroup" aria-label="Show the videos as" className="video-view" value={view} onChange={setView}
            options={[{ value: 'grid', label: <><LayoutGrid aria-hidden="true" />Grid</>, title: 'Large thumbnails, side by side' },
              { value: 'list', label: <><List aria-hidden="true" />List</>, title: 'One video a row' }]} />}
        </div>
        {shown.length > 0 ? <>
          <ul className="video-list" data-view={view}>{shown.map((v) => <VideoRow key={v.id} v={v} view={view} q={q.trim()} />)}</ul>
          {shown.length < d.total && (
            <div className="video-more">
              <Button size="small" aria-busy={more} disabled={more} onClick={async () => {
                setMore(true)
                try {
                  const x = await api.heardVideos(channel, q, shown.length, PAGE)
                  setExtra((e) => ({ asked, rows: [...(e.asked === asked ? e.rows : []), ...x.videos] }))
                } finally { setMore(false) }
              }}>Show more</Button>
              <span className="meta num">{shown.length} of {d.total.toLocaleString()}</span>
            </div>
          )}
        </> : (
          <EmptyState>
            {q.trim() ? <>
              <h2>Nothing found</h2>
              <p>No video here has “{q.trim()}” in its title, its channel or its lines{channel ? ' on this channel' : ''}.</p>
            </> : d.channels.length === 0 && !d.found ? <>
              <h2>No channels yet</h2>
              <p>Follow a YouTube channel or playlist with Japanese subtitles, and its videos show up here once their subtitles are read.</p>
              <ButtonLink variant="primary" to="/addons#youtube">Follow a channel</ButtonLink>
            </> : d.reading.waiting > 0 ? <>
              <h2>Reading subtitles</h2>
              <p>{plural(d.reading.waiting, 'video')} still to look at. Videos show up here as their subtitles are read.</p>
            </> : <>
              <h2>No subtitled videos</h2>
              <p>None of these videos has Japanese subtitles written by people. Automatic captions aren’t read: they’re too often wrong to learn from.</p>
            </>}
          </EmptyState>
        )}
      </>}
    </>
  )
}

function VideoRow({ v, view, q }: { v: HeardVideoRow; view: View; q: string }) {
  // found by something said in it: it opens at the first line that says it
  const to = `/sources/youtube/${v.id}` + (v.said ? `?at=${v.said.line.id}` : '')
  const thumb = `https://i.ytimg.com/vi/${v.yt_id}/`
  return (
    <li className="video-row">
      <Link to={to} className="video-thumb" tabIndex={-1} aria-hidden="true">
        <img src={`${thumb}mqdefault.jpg`} srcSet={`${thumb}mqdefault.jpg 320w, ${thumb}hqdefault.jpg 480w`}
          sizes={view === 'grid' ? '(max-width: 760px) 100vw, 22rem' : '10rem'} alt="" loading="lazy"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        {v.duration != null && <span className="num">{clockTime(v.duration)}</span>}
      </Link>
      <span className="video-main">
        <Link to={to} className="video-name" lang="ja">{plain(v.title) || v.yt_id}</Link>
        <span className="meta">
          {v.uploader && <span lang="ja">{plain(v.uploader)}</span>}
          {v.published && <span>{day(v.published)}</span>}
          <span className="num">{plural(v.lines, 'line')}</span>
          {v.kept > 0 && v.source != null && <Link to={`/sources/${v.source}`} title="The source your kept lines went into">{v.kept} kept</Link>}
          {v.gone && <Plate tone="hollow" title="It was made private or deleted since its subtitles were read">gone from YouTube</Plate>}
        </span>
        {v.said && <Link to={to} className="video-said" title="Play it from this line">
          <span lang="ja"><Marked text={v.said.line.text} q={q} /></span>
          {v.said.lines > 1 && <span className="meta num">and {plural(v.said.lines - 1, 'more line')}</span>}
        </Link>}
      </span>
    </li>
  )
}

/** A line with what was searched for marked in it. */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

// --- one video, watched with its lines --------------------------------------------------------

export function VideoPage() {
  const id = Number(useParams().id)
  return <VideoDetail key={id} id={id} />
}

function VideoDetail({ id }: { id: number }) {
  const video = useAsync(() => api.heardVideo(id), [id])
  const backTo = useBackTo(`video:${id}`, () => false)
  const [params] = useSearchParams()
  const stats = useStats()
  const toast = useToast()
  if (video.error) return <ErrorNotice error={video.error} action={<Link to="/sources/youtube">Open YouTube</Link>} />
  if (!video.data) return <Skeleton rows={4} />
  const v = video.data
  const channel = v.channels[0]
  const kept = (line: number, sentence: number, source: number) => {
    video.set((x) => x && { ...x, source, kept: x.kept + 1, lines: x.lines.map((l) => l.id === line ? { ...l, sentence } : l) })
    stats.refresh()
    toast({ text: 'Kept: it’s in your inbox, with its audio' })
  }
  return (
    <div className="video-page">
      <header className="page-head video-head">
        <ButtonLink variant="ghost" icon to={backTo ?? '/sources/youtube'} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <div className="video-title">
          <h1 lang="ja" title={plain(v.title)}>{plain(v.title) || v.yt_id}</h1>
          <p className="meta">
            {channel ? <Link to={`/sources/youtube?channel=${channel.id}`} lang="ja">{plain(channel.title)}</Link> : v.uploader && <span lang="ja">{plain(v.uploader)}</span>}
            {v.published && <> · {day(v.published)}</>}
            {' · '}<span className="num">{plural(v.lines.length, 'line')}</span>
            {v.kept > 0 && v.source != null && <> · <Link to={`/sources/${v.source}`} title="The source your kept lines went into">{v.kept} kept</Link></>}
          </p>
        </div>
        <a className={buttonClass({ variant: 'ghost' })} href={v.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />YouTube</a>
      </header>
      {v.lines.length > 0
        ? <Watch v={v} startLine={Number(params.get('at')) || null} onKept={kept} />
        : <EmptyState><h2>No lines in this video</h2><p>{v.subs === 'waiting' ? 'Its subtitles haven’t been read yet.' : 'It has no Japanese subtitles written by people.'}</p></EmptyState>}
    </div>
  )
}

/** What the transport asks of whichever is playing: YouTube's own player, or the video's audio
 *  from kotoba's copy. */
type Engine = { time: () => number; seek: (t: number) => void; play: () => void; pause: () => void; rate: (r: number) => void }
type Events = { onReady: (duration: number) => void; onPlaying: (on: boolean) => void; onError: (why: string) => void }
type Mode = 'video' | 'audio'

function Watch({ v, startLine, onKept }: { v: HeardVideoDetail; startLine: number | null; onKept: (line: number, sentence: number, source: number) => void }) {
  const lines = v.lines
  const first = lines.find((l) => l.id === startLine)
  const [chosen, choose] = usePref<Mode>('video-mode', 'video')
  // a video YouTube won't play here falls back to its sound, for this time only
  const [forced, setForced] = useState<Mode | null>(null)
  const mode = forced ?? chosen
  const [why, setWhy] = useState<string | null>(null)
  const engine = useRef<Engine | null>(null)
  const [time, setTime] = useState(first?.start ?? 0)
  const [duration, setDuration] = useState(v.duration ?? 0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [speed, setSpeed] = usePref('video-speed', 1)
  const [repeat, setRepeat] = useState(false)
  const [loopLine, setLoopLine] = useState(-1)
  const [follow, setFollow] = useState(true)
  const [furigana, setFurigana] = usePref('furigana', true)
  const scroller = useRef<HTMLDivElement>(null)
  // where a player that is (re)starting begins: the line asked for, or wherever the last one was
  const startAt = useRef(first?.start ?? 0)
  // the line being said, or the last one begun: the pause after a line still belongs to it
  const at = lines.findLastIndex((x) => x.start <= time + .05)

  // while playing, follow the player's clock (a tenth of a second is fine enough for lines);
  // a repeated line loops back to its start
  const loop = useRef<[number, number] | null>(null)
  useEffect(() => {
    const line = lines[loopLine]
    loop.current = repeat && line ? [line.start, line.end] : null
  }, [repeat, loopLine, lines])
  useEffect(() => {
    if (!playing) return
    let frame = 0, last = -1
    const tick = () => {
      const e = engine.current
      if (e) {
        let t = e.time()
        const r = loop.current
        if (r && (t >= r[1] || t < r[0] - .25)) { e.seek(r[0]); t = r[0] }
        if (Math.abs(t - last) >= .1) { last = t; setTime(t) }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])
  useEffect(() => { engine.current?.rate(speed) }, [speed])

  const events: Events = {
    onReady: (d) => { setReady(true); if (d) setDuration(d); engine.current?.rate(speed) },
    onPlaying: setPlaying,
    onError: (message) => {
      setReady(false); setPlaying(false)
      setWhy(message)
      if (mode === 'video') { startAt.current = time; setForced('audio') }
    },
  }
  const switchTo = (m: Mode) => {
    if (m === mode) return
    startAt.current = engine.current?.time() ?? time
    engine.current = null
    setReady(false); setPlaying(false); setWhy(null)
    setForced(null); choose(m)
  }

  const seek = useCallback((t: number) => { engine.current?.seek(Math.max(0, t)); setTime(Math.max(0, t)) }, [])
  const play = () => engine.current?.play()
  const pause = () => engine.current?.pause()
  const toggle = () => { if (playing) pause(); else play() }
  // a repeated line moves with you: wherever you go, the line there is the one that repeats
  const loopAt = useCallback((i: number) => {
    setLoopLine(i)
    if (loop.current && lines[i]) loop.current = [lines[i].start, lines[i].end]
  }, [lines])
  const goToLine = useCallback((i: number) => {
    if (!lines[i]) return
    setFollow(true); loopAt(i); seek(lines[i].start)
  }, [lines, seek, loopAt])
  const playLine = useCallback((i: number) => { goToLine(i); engine.current?.play() }, [goToLine])
  // back restarts the line you're in, unless you're just past its start, like a music player
  const prev = () => goToLine(at >= 0 && time - lines[at].start > 1.5 ? at : Math.max(0, at - 1))
  const next = () => playLine(Math.min(lines.length - 1, at + 1))
  const toggleRepeat = () => { setRepeat(!repeat); setLoopLine(Math.max(0, at)) }
  // looking a word up stops the voice, so the line stays put while you read the card
  const playingRef = useRef(playing)
  useEffect(() => { playingRef.current = playing }, [playing])
  const hold = useCallback(() => { if (playingRef.current) engine.current?.pause() }, [])

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

  // keep the line being said in the upper part of the list, unless the reader scrolled away;
  // a line linked to (?at=) is brought into view once at the start
  useEffect(() => {
    const box = scroller.current
    const el = box?.querySelector<HTMLElement>(`[data-line="${at}"]`)
    if (!box || !el || !follow || (!playing && !first)) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    if (r.top >= b.top + b.height * .08 && r.bottom <= b.top + b.height * .65) return
    const calm = !playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollBy({ top: r.top - (b.top + b.height * .2), behavior: calm ? 'auto' : 'smooth' })
  }, [at, follow, playing, first])

  const span = duration || lines.at(-1)?.end || 0
  const pct = (t: number) => `${span ? Math.min(100, t / span * 100) : 0}%`
  const line = lines[at]

  return (
    <div className="video-desk">
      <section className="listen video-player" aria-label="Player">
        {mode === 'video'
          ? <YouTubeFrame key="video" ytId={v.yt_id} start={startAt} engine={engine} events={events} />
          : <AudioTrack key="audio" v={v} start={startAt} engine={engine} events={events} />}
        {/* the line being said, at reading size: tap a word to look it up */}
        <div className="video-caption" lang="ja" onClick={hold}>
          {line ? <Furigana key={line.id} text={line.text} pairs={line.furigana} show={furigana} />
            : <span className="meta">The lines show here as they’re said.</span>}
        </div>
        <div className="listen-deck">
          <div className="listen-rail" data-lines>
            {lines.map((x, i) => <i key={x.id} data-state={i === at ? 'now' : i < at ? 'past' : undefined} data-loop={repeat && i === loopLine || undefined}
              style={{ left: pct(x.start), width: `calc(${pct(x.end - x.start)} - 1px)` }} />)}
            <b className="listen-playhead" style={{ left: pct(time) }} aria-hidden="true" />
            <input type="range" min={0} max={span || 1} step={.1} value={Math.min(time, span || 0)} disabled={!ready}
              aria-label="Seek" aria-valuetext={`${clockTime(time)} of ${clockTime(span)}`}
              onChange={(e) => { const t = Number(e.target.value); setFollow(true); loopAt(Math.max(0, lines.findLastIndex((x) => x.start <= t + .05))); seek(t) }}
              onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); toggle() } }} />
          </div>
          <div className="listen-transport">
            <Button variant="ghost" size="small" icon disabled={!ready} onClick={prev} aria-label="Previous line" title="Previous line (←)"><SkipBack aria-hidden="true" /></Button>
            <Button variant="primary" size="small" icon className="listen-play" disabled={!ready} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
            <Button variant="ghost" size="small" icon disabled={!ready} onClick={next} aria-label="Next line" title="Next line (→)"><SkipForward aria-hidden="true" /></Button>
            <span className="listen-times num" aria-hidden="true">{clockTime(time)} / {clockTime(span)}{at >= 0 && <> · line {at + 1} of {lines.length}</>}</span>
            <span className="grow" />
            <Button variant="ghost" size="small" className="listen-repeat" aria-pressed={repeat} disabled={!ready} onClick={toggleRepeat} title="Repeat the current line (R)">
              <Repeat1 aria-hidden="true" />Repeat line</Button>
            <label className="listen-speed"><span className="sr">Speed</span>
              <Select value={speed} title="Speed" onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.5, 0.75, 1, 1.25].map((r) => <option key={r} value={r}>{r}×</option>)}
              </Select></label>
            <Segmented name="video-mode" role="radiogroup" aria-label="Play" className="video-mode" value={mode} onChange={switchTo}
              options={[{ value: 'video', label: 'Video', title: 'YouTube’s player' }, { value: 'audio', label: 'Audio', title: 'Only the sound, from kotoba’s copy: no ads, works when YouTube won’t embed it' }]} />
          </div>
          {why && <p className="meta" role="alert">{why}</p>}
        </div>
      </section>

      <section className="listen video-script" aria-label="Lines">
        <div className="listen-aids">
          <div className="aids" role="group" aria-label="Reading aids">
            <ChipButton type="button" aria-pressed={furigana} onClick={() => setFurigana(!furigana)} title="Furigana over the kanji"><span lang="ja">ふりがな</span></ChipButton>
          </div>
        </div>
        <div className="listen-script" ref={scroller} onWheel={() => playing && setFollow(false)} onTouchMove={() => playing && setFollow(false)}>
          <ol className="listen-lines">
            {lines.map((x, i) => <Row key={x.id} x={x} i={i} state={i === at ? 'now' : i < at ? 'past' : ''} furigana={furigana}
              onPlay={playLine} onText={hold} onKept={onKept} />)}
          </ol>
          {playing && !follow && at >= 0 && <Button variant="primary" size="small" className="listen-follow" onClick={() => setFollow(true)}><ListEnd aria-hidden="true" />Back to the current line</Button>}
        </div>
        <p className="meta listen-keys">Space: play / pause · ← →: previous / next line · R: repeat · tap a word to look it up</p>
      </section>
    </div>
  )
}

const Row = memo(function Row({ x, i, state, furigana, onPlay, onText, onKept }: {
  x: VideoLine; i: number; state: 'now' | 'past' | ''; furigana: boolean
  onPlay: (i: number) => void; onText: () => void; onKept: (line: number, sentence: number, source: number) => void
}) {
  return (
    <li data-line={i} data-state={state || undefined} aria-current={state === 'now' ? 'true' : undefined}>
      <button type="button" className="tc num" onClick={() => onPlay(i)} aria-label={`Play from ${clockTime(x.start)}`} title="Play from here">{clockTime(x.start)}</button>
      <div className="listen-text" lang="ja" onClick={onText}><Furigana text={x.text} pairs={x.furigana} show={furigana} /></div>
      <Keep x={x} onKept={onKept} />
    </li>
  )
})

/** Keep a line: it becomes one of your sentences, in the inbox under this video, with its audio. */
function Keep({ x, onKept }: { x: VideoLine; onKept: (line: number, sentence: number, source: number) => void }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (x.sentence) return (
    <Link className="video-kept" to={`/sentences/${x.sentence}`} aria-label="Kept: open the sentence" title="It’s one of your sentences: open it"><Check aria-hidden="true" /></Link>
  )
  return (
    <button type="button" className="listen-quote video-keep" disabled={busy} aria-busy={busy} aria-label={`Keep line ${clockTime(x.start)} as a sentence`}
      title="Keep it as one of your sentences, with its audio" onClick={async () => {
        setBusy(true)
        try { const r = await api.keepLine(x.id); onKept(x.id, r.sentence, r.source) } catch (e) { toast({ text: (e as Error).message }) } finally { setBusy(false) }
      }}><BookmarkPlus aria-hidden="true" /></button>
  )
}

// --- the players ------------------------------------------------------------------------------

type YTPlayer = {
  getCurrentTime(): number; getDuration(): number; seekTo(t: number, ahead: boolean): void
  playVideo(): void; pauseVideo(): void; setPlaybackRate(r: number): void; destroy(): void
}
type YTApi = { Player: new (el: HTMLElement, o: { events: Record<string, (e: { data: number; target: YTPlayer }) => void> }) => YTPlayer }

let youtube: Promise<YTApi> | null = null
/** YouTube's IFrame player API, loaded once, the first time a video is watched. */
function loadYouTube(): Promise<YTApi> {
  const w = window as unknown as { YT?: YTApi; onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  youtube ??= new Promise<YTApi>((resolve, reject) => {
    const before = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { before?.(); resolve(w.YT!) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => { youtube = null; s.remove(); reject(new Error('YouTube’s player couldn’t be reached, so the audio plays from kotoba’s copy.')) }
    document.head.appendChild(s)
  })
  return youtube
}

const YT_ERRORS: Record<number, string> = {
  100: 'YouTube no longer has this video, so the audio plays from kotoba’s copy.',
  101: 'Its owner doesn’t let it play outside YouTube, so the audio plays from kotoba’s copy.',
  150: 'Its owner doesn’t let it play outside YouTube, so the audio plays from kotoba’s copy.',
}

/** YouTube's own player. The frame is made here rather than by React, since the API takes it
 *  over; it sends the page's address so YouTube agrees to play it embedded. */
function YouTubeFrame({ ytId, start, engine, events }: { ytId: string; start: RefObject<number>; engine: RefObject<Engine | null>; events: Events }) {
  const host = useRef<HTMLDivElement>(null)
  const on = useRef(events)
  useEffect(() => { on.current = events })
  useEffect(() => {
    const box = host.current!
    const frame = document.createElement('iframe')
    frame.src = `https://www.youtube-nocookie.com/embed/${ytId}?` + new URLSearchParams({
      enablejsapi: '1', origin: window.location.origin, playsinline: '1', rel: '0', iv_load_policy: '3', start: String(Math.floor(start.current)),
    })
    frame.title = 'YouTube video'
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    frame.referrerPolicy = 'strict-origin-when-cross-origin'
    box.replaceChildren(frame)
    let player: YTPlayer | null = null, live = true
    loadYouTube().then((YT) => {
      if (!live) return
      player = new YT.Player(frame, { events: {
        onReady: ({ target: p }) => {
          engine.current = { time: () => p.getCurrentTime(), seek: (t) => p.seekTo(t, true), play: () => p.playVideo(), pause: () => p.pauseVideo(), rate: (r) => p.setPlaybackRate(r) }
          on.current.onReady(p.getDuration())
        },
        // playing, or buffering on the way: the clock keeps being read
        onStateChange: ({ data }) => on.current.onPlaying(data === 1 || data === 3),
        onError: ({ data }) => on.current.onError(YT_ERRORS[data] ?? `YouTube’s player stopped (error ${data}), so the audio plays from kotoba’s copy.`),
      } })
    }, (e: Error) => { if (live) on.current.onError(e.message) })
    return () => { live = false; engine.current = null; try { player?.destroy() } catch { /* already gone */ } box.replaceChildren() }
  }, [ytId, start, engine])
  return <div className="video-frame" ref={host} />
}

/** The video's sound alone, from kotoba's copy: fetched from YouTube the first time (a few seconds). */
function AudioTrack({ v, start, engine, events }: { v: HeardVideoDetail; start: RefObject<number>; engine: RefObject<Engine | null>; events: Events }) {
  const [here, setHere] = useState(v.here)
  const [failed, setFailed] = useState<string | null>(null)
  const media = useRef<HTMLAudioElement>(null)
  const on = useRef(events)
  useEffect(() => { on.current = events })
  useEffect(() => {
    if (here) return
    let live = true
    api.heardAudio(v.id).then(() => live && setHere(true), (e: Error) => { if (live) setFailed(e.message) })
    return () => { live = false }
  }, [here, v.id])
  useEffect(() => {
    const a = media.current
    if (!here || !a) return
    engine.current = { time: () => a.currentTime, seek: (t) => { a.currentTime = t }, play: () => { void a.play().catch(() => {}) }, pause: () => a.pause(), rate: (r) => { a.playbackRate = r } }
    return () => { engine.current = null }
  }, [here, engine])
  return (
    <div className="video-audio" role="status">
      <AudioLines aria-hidden="true" />
      {failed ? <span>{failed}</span>
        : !here ? <span><LoaderCircle className="loading-spinner" aria-hidden="true" />Fetching the sound from YouTube. Only the first time takes a few seconds.</span>
          : <span>Sound only</span>}
      {here && <audio ref={media} src={`/api/youtube/videos/${v.id}/audio`} preload="auto"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = start.current
          on.current.onReady(e.currentTarget.duration)
        }}
        onPlay={() => on.current.onPlaying(true)} onPause={() => on.current.onPlaying(false)} onEnded={() => on.current.onPlaying(false)}
        onError={() => setFailed('The sound couldn’t be played here.')} />}
    </div>
  )
}
