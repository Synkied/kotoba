import { BookmarkPlus, Check, ChevronsDownUp, ChevronsUpDown, ExternalLink, Search, Square, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, type Heard, type HeardFinding, type HeardLine } from '../lib/api'
import { playClip, stopAudio } from '../lib/audio'
import { Furigana } from './Furigana'
import { SentenceText } from './SentenceText'
import { fmtTime } from './SourcePanel'
import { usePref } from './ui'
import { Button, Chip, Plate } from './ds'

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const PAD = 0.3 // seconds of air either side of a line
/** a title as a label: no emoji (🇯🇵, ⛰️), which the label's typeface doesn't draw */
const plain = (t: string) => t.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, '').replace(/\s+([|｜·])/g, ' $1').replace(/\s{2,}/g, ' ').trim()
const PAGE = 5

/** Playing heard lines, one at a time. A video's audio comes from YouTube the first time one of
 *  its lines is played (a few seconds), then every line of it plays at once. */
function useHeardPlayer() {
  const [playing, setPlaying] = useState<number | null>(null)
  const [fetching, setFetching] = useState<number | null>(null)
  const [here, setHere] = useState<Set<number>>(new Set())
  const [failed, setFailed] = useState<Record<number, string>>({})
  const current = useRef<number | null>(null)
  useEffect(() => () => { if (current.current !== null) stopAudio() }, [])
  const play = useCallback(async (l: HeardLine) => {
    if (current.current === l.id) { stopAudio(); current.current = null; setPlaying(null); return }
    stopAudio()
    current.current = l.id
    setPlaying(l.id)
    setFailed((f) => { const next = { ...f }; delete next[l.id]; return next })
    try {
      if (!l.video.here && !here.has(l.video.id)) {
        setFetching(l.video.id)
        try { await api.heardAudio(l.video.id) } finally { setFetching((v) => (v === l.video.id ? null : v)) }
        setHere((s) => new Set(s).add(l.video.id))
        if (current.current !== l.id) return // another line was asked for meanwhile
      }
      await playClip(`/api/youtube/videos/${l.video.id}/audio`, Math.max(0, l.start - PAD), l.end + PAD)
    } catch (e) {
      if (current.current === l.id) setFailed((f) => ({ ...f, [l.id]: (e as Error).message }))
    } finally {
      if (current.current === l.id) { current.current = null; setPlaying(null) }
    }
  }, [here])
  return { playing, fetching, failed, play }
}
type Player = ReturnType<typeof useHeardPlayer>

/** Listen to one line: its own seconds of the video, cut from the native audio. */
function ListenHeard({ l, player }: { l: HeardLine; player: Player }) {
  const on = player.playing === l.id
  const busy = on && player.fetching === l.video.id
  const label = busy ? 'Fetching the audio from YouTube' : on ? 'Stop' : 'Listen'
  return (
    <Button variant="ghost" size="small" icon aria-pressed={on} aria-busy={busy} aria-label={label} title={label} onClick={() => player.play(l)}>
      {on && !busy ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </Button>
  )
}

/** Keep the line: it becomes one of your sentences, in the inbox under its video. */
function KeepHeard({ l, onKept }: { l: HeardLine; onKept: (sentence: number) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (l.sentence) return (
    <Link className="heard-kept" to={`/sentences/${l.sentence}`} title="It’s one of your sentences now, in the inbox">
      <Check aria-hidden="true" />Kept
    </Link>
  )
  return <>
    <Button size="small" aria-busy={busy} disabled={busy} title="Make it one of your sentences, with its audio"
      onClick={async () => {
        setBusy(true); setError(null)
        try { onKept((await api.keepLine(l.id)).sentence) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
      }}>
      <BookmarkPlus aria-hidden="true" />Keep
    </Button>
    {error && <span className="meta heard-error" role="alert">{error}</span>}
  </>
}

/** The video a line is from, pinned under it as a kraft tag: channel · title · time, opening
 *  YouTube at that moment. */
function VideoTag({ l }: { l: HeardLine }) {
  const v = l.video
  return (
    <Chip className="source-tag heard-tag" data-dye="media">
      <a href={v.url} target="_blank" rel="noreferrer" title={`Watch on YouTube from ${fmtTime(l.start)}`}>
        {v.uploader && <b>{v.uploader}</b>}{v.uploader && ' · '}{plain(v.title) || v.yt_id}
      </a>
      <span className="num">{fmtTime(l.start)}</span>
      <ExternalLink aria-hidden="true" />
    </Chip>
  )
}

/** One line: the line before it, the line itself at reading size with the word marked, the line
 *  after; then where it's from and how much of it you'd follow. Opening it shows the transcript
 *  around it, as the video goes. */
function HeardRow({ l, termKey, player, furigana, compact = false }: {
  l: HeardLine; termKey?: string; player: Player; furigana: boolean; compact?: boolean
}) {
  const [line, setLine] = useState(l)
  const [around, setAround] = useState<HeardLine[] | null>(null)
  const [open, setOpen] = useState(false)
  const now = player.playing === line.id
  const fetching = now && player.fetching === line.video.id
  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (!around) {
      try { setAround((await api.heardContext(line.id, termKey)).lines) } catch { setAround([]) }
    }
  }
  return (
    <li className={'heard-row' + (now ? ' now' : '')} aria-current={now ? 'true' : undefined}>
      <div className="heard-body">
        {!compact && !open && line.before && <p className="heard-near" lang="ja">{line.before}</p>}
        {open && around ? <Around lines={around} at={line.id} player={player} furigana={furigana} /> : (
          <SentenceText><Furigana text={line.text} pairs={line.furigana} show={furigana} marks={line.spans} /></SentenceText>
        )}
        {!compact && !open && line.after && <p className="heard-near" lang="ja">{line.after}</p>}
        <div className="heard-foot">
          <VideoTag l={line} />
          {line.new === 0 && <Plate tone="hollow" title="You know every other word in it">every other word known</Plate>}
          {!!line.new && <span className="meta num">{line.new === 1 ? '1 other new word' : `${line.new} other new words`}</span>}
        </div>
        {fetching && <p className="meta heard-status" role="status">Fetching this video’s audio from YouTube. Only the first line of a video takes a few seconds.</p>}
        {player.failed[line.id] && <p className="meta heard-error" role="alert">{player.failed[line.id]}</p>}
      </div>
      <div className="acts">
        <ListenHeard l={line} player={player} />
        {!compact && <Button variant="ghost" size="small" icon aria-expanded={open} aria-label={open ? 'Hide what’s said around it' : 'Show what’s said around it'}
          title={open ? 'Back to the line' : 'What’s said around it'} onClick={toggle}>
          {open ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
        </Button>}
        <KeepHeard l={line} onKept={(sentence) => setLine({ ...line, sentence })} />
      </div>
    </li>
  )
}

/** The transcript around a line: each one plays from its time code, and can be kept. */
function Around({ lines, at, player, furigana }: { lines: HeardLine[]; at: number; player: Player; furigana: boolean }) {
  const [kept, setKept] = useState<Record<number, number>>({})
  if (!lines.length) return <p className="meta">Couldn’t read the lines around it.</p>
  return (
    <ol className="heard-around" lang="ja">
      {lines.map((c) => {
        const it = { ...c, sentence: kept[c.id] ?? c.sentence }
        const playing = player.playing === c.id
        return (
          <li key={c.id} className={(c.id === at ? 'here' : '') + (playing ? ' now' : '')}>
            <button type="button" className="tc num" aria-label={`Play from ${fmtTime(c.start)}`} onClick={() => player.play(it)}>{fmtTime(c.start)}</button>
            <span className="heard-around-text"><Furigana text={c.text} pairs={c.furigana} show={furigana} marks={c.spans} /></span>
            {c.id !== at && <span className="heard-around-keep"><KeepHeard l={it} onKept={(s) => setKept((k) => ({ ...k, [c.id]: s }))} /></span>}
          </li>
        )
      })}
    </ol>
  )
}

function findingText(f: HeardFinding, lemma: string) {
  if (f.state === 'searching') return `Searching YouTube for ${lemma}…`
  if (f.state === 'checking') return `Looking for Japanese subtitles in ${plural(f.waiting, 'video')}…`
  if (f.error) return f.error
  return f.subtitled ? `Found ${plural(f.subtitled, 'video')} with Japanese subtitles.` : `None of the ${plural(f.videos, 'video')} YouTube found had Japanese subtitles.`
}

/** Heard on YouTube: the word said by native speakers, in the subtitled videos of the channels
 *  you follow. The lines easiest to follow come first: the fewest other words you don't know. */
export function HeardSection({ termKey, lemma }: { termKey: string; lemma: string }) {
  const [h, setH] = useState<Heard | null>(null)
  const [extra, setExtra] = useState<HeardLine[]>([])
  const [more, setMore] = useState(false)
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState(false) // pressed Find more here: say how it went
  const [error, setError] = useState<string | null>(null)
  const [furigana] = usePref('furigana', true)
  const player = useHeardPlayer()
  const { hash } = useLocation()
  const load = useCallback(() => api.heard(termKey, 0, PAGE).then((x) => { setH(x); setExtra([]) }, () => {}), [termKey])
  useEffect(() => { load() }, [load])
  // while subtitles are still being read, or a search runs, look again now and then
  const finding = h?.finding?.state === 'searching' || h?.finding?.state === 'checking'
  const reading = !!h && h.enabled && h.reading.busy && h.total < PAGE
  useEffect(() => {
    if (!finding && !reading) return
    const t = window.setTimeout(load, finding ? 2500 : 6000)
    return () => window.clearTimeout(t)
  }, [finding, reading, h, load])
  const arrived = !!h && hash === '#heard'
  useEffect(() => { if (arrived) document.getElementById('heard')?.scrollIntoView({ block: 'start' }) }, [arrived])
  if (!h) return null

  const head = (
    <div className="day-head heard-head">
      <h2 className="date" data-dye="media">Heard on YouTube</h2>
      {h.total > 0 && <span className="meta num">{plural(h.total, 'line')} in {plural(h.videos, 'video')}</span>}
      <span className="grow" />
      {h.enabled && h.channels + (h.finding ? 1 : 0) > 0 && (
        <Button size="small" variant="ghost" aria-busy={asking || finding} disabled={asking || finding}
          title={`Search YouTube for ${lemma} and read the subtitles of what it finds`}
          onClick={async () => {
            setAsking(true); setAsked(true); setError(null)
            try { const r = await api.findMore(termKey); setH((x) => x && { ...x, finding: r.finding }) }
            catch (e) { setError((e as Error).message) } finally { setAsking(false) }
          }}>
          <Search aria-hidden="true" />Find more
        </Button>
      )}
    </div>
  )

  if (!h.enabled) return (
    <section className="heard" id="heard" aria-label="Heard on YouTube">
      {head}
      <p className="heard-empty">Hear <span lang="ja">{lemma}</span> from native speakers: follow YouTube channels with Japanese subtitles, and the lines with it play here. <Link to="/addons#youtube">Set up YouTube listening</Link></p>
    </section>
  )

  const shown = [...h.lines, ...extra]
  return (
    <section className="heard" id="heard" aria-label="Heard on YouTube">
      {head}
      {h.finding && (h.finding.state !== 'done' || asked) && (
        <p className="meta heard-status" role="status">{findingText(h.finding, lemma)}</p>
      )}
      {error && <p className="meta heard-error" role="alert">{error}</p>}
      {shown.length > 0 ? <>
        <ol className="heard-rows">{shown.map((l) => <HeardRow key={l.id} l={l} termKey={termKey} player={player} furigana={furigana} />)}</ol>
        {shown.length < h.total && (
          <div className="heard-more">
            <Button size="small" aria-busy={more} disabled={more} onClick={async () => {
              setMore(true)
              try { const x = await api.heard(termKey, shown.length, PAGE * 2); setExtra((e) => [...e, ...x.lines]) } finally { setMore(false) }
            }}>Show more</Button>
            <span className="meta num">{shown.length} of {h.total.toLocaleString()}</span>
          </div>
        )}
      </> : (
        <p className="heard-empty">
          {h.channels === 0 && !h.finding ? <>Not heard yet: you don’t follow any channels. <Link to="/addons#youtube">Follow one</Link>, or press Find more to search YouTube for <span lang="ja">{lemma}</span>.</>
            : h.reading.waiting > 0 ? <>Not heard yet. Subtitles are still being read: {plural(h.reading.waiting, 'video')} to go.</>
              : <>Not in the videos of the channels you follow. Find more searches YouTube for it.</>}
        </p>
      )}
    </section>
  )
}

/** Search results: lines heard on YouTube, a few, with where they're from. */
export function HeardList({ lines }: { lines: HeardLine[] }) {
  const [furigana] = usePref('furigana', true)
  const player = useHeardPlayer()
  return <ol className="heard-rows">{lines.map((l) => <HeardRow key={l.id} l={l} player={player} furigana={furigana} compact />)}</ol>
}
