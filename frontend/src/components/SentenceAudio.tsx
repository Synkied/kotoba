import { useEffect, useRef, useState } from 'react'
import { api, type Sentence, type Source } from '../lib/api'
import { fmtTime } from './SourcePanel'
import { ErrorNotice } from './ui'

export function SentenceAudio({ sentence: s, source }: { sentence: Sentence; source: Source }) {
  const audio = useRef<HTMLAudioElement>(null)
  const clipOnly = useRef(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<{ rate: number; peaks: number[]; duration: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [time, setTime] = useState(s.start ?? 0)
  const [duration, setDuration] = useState(source.duration ?? 0)
  const [full, setFull] = useState(false)
  const [loop, setLoop] = useState(false)
  const [speed, setSpeed] = useState('1')
  const clipEnd = s.end ?? duration
  const from = full ? 0 : Math.max(0, (s.start ?? 0) - 2)
  const to = full ? duration : Math.min(duration, clipEnd + 2)
  useEffect(() => {
    let live = true
    api.peaks(source.id).then(p => { if (live) { peaks.current = p; setDuration(p.duration); setLoaded(true) } }, e => live && setError(e))
    return () => { live = false }
  }, [source.id])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const draw = () => {
      const p = peaks.current
      const width = c.clientWidth, height = c.clientHeight, dpr = window.devicePixelRatio || 1
      c.width = width * dpr; c.height = height * dpr
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      const css = getComputedStyle(c), ink = css.getPropertyValue('--ink').trim(), faint = css.getPropertyValue('--ink-3').trim()
      const span = to - from
      if (!p || span <= 0) return
      const x = (t: number) => (t - from) / span * width
      g.fillStyle = faint; g.globalAlpha = .15
      g.fillRect(x(s.start ?? 0), 0, x(clipEnd) - x(s.start ?? 0), height)
      g.globalAlpha = 1
      for (let k = 0; k < width; k += 3) {
        const t = from + k / width * span
        let peak = 0
        const a = Math.floor(t * p.rate), b = Math.max(a + 1, Math.ceil((t + 3 / width * span) * p.rate))
        for (let j = a; j < b; j++) peak = Math.max(peak, p.peaks[j] ?? 0)
        g.fillStyle = t >= (s.start ?? 0) && t <= clipEnd ? ink : faint
        const h = Math.max(2, peak * height * .9)
        g.fillRect(k, (height - h) / 2, 2, h)
      }
      g.fillStyle = ink; g.fillRect(x(time), 0, 2, height)
    }
    draw()
    const resize = new ResizeObserver(draw); resize.observe(c)
    return () => resize.disconnect()
  }, [loaded, from, to, time, s.start, clipEnd])
  const seek = (t: number) => { clipOnly.current = false; if (audio.current) audio.current.currentTime = t; setTime(t) }
  return <section className="sentence-audio" aria-label="Browse source audio">
    <div className="btn-row"><h2>Audio</h2><span className="grow" />
      <button className="btn small" aria-pressed={full} onClick={() => setFull(!full)}>{full ? 'Focus on sentence' : 'Show full source'}</button>
    </div>
    {error ? <ErrorNotice error={error} /> : !loaded ? <p role="status" className="meta">Drawing the waveform…</p> : <>
      <canvas ref={canvas} className="sentence-wave" role="img" aria-label="Audio waveform. Shaded region marks this sentence." onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek(from + (e.clientX - r.left) / r.width * (to - from)) }} />
      <label className="sentence-seek"><span className="sr">Seek audio</span><input type="range" min={from} max={Math.max(from, to)} step="0.01" value={Math.max(from, Math.min(to, time))} onChange={e => seek(Number(e.target.value))} aria-valuetext={fmtTime(time)} /></label>
      <div className="times num"><span>{fmtTime(from)}</span><span>{fmtTime(time)}</span><span>{fmtTime(to)}</span></div>
    </>}
    <p className="meta">Click the waveform or move the slider to browse. The shaded region is this sentence.</p>
    <audio ref={audio} controls src={source.media!} preload="metadata" onLoadedMetadata={e => { setDuration(e.currentTarget.duration); e.currentTarget.currentTime = s.start ?? 0; e.currentTarget.playbackRate = Number(speed) }} onTimeUpdate={e => {
      const a = e.currentTarget
      if ((loop || clipOnly.current) && a.currentTime >= clipEnd) {
        if (loop) a.currentTime = s.start ?? 0
        else { a.pause(); clipOnly.current = false; a.currentTime = clipEnd }
      }
      setTime(a.currentTime)
    }} onEnded={() => { if (loop && audio.current) { seek(s.start ?? 0); void audio.current.play().catch(setError) } }} />
    <div className="btn-row">
      <button className="btn" onClick={() => { seek(s.start ?? 0); clipOnly.current = true; void audio.current?.play().catch(setError) }}>Play sentence</button>
      {s.start != null && s.end != null && <label><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Repeat sentence</label>}
      <label>Speed <select className="select" value={speed} onChange={e => { setSpeed(e.target.value); if (audio.current) audio.current.playbackRate = Number(e.target.value) }}>{['0.5', '0.75', '1', '1.25'].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>
    </div>
  </section>
}
