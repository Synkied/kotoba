import { useEffect, useRef, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import { api, type Sentence, type Source } from '../lib/api'
import { fmtTime } from './SourcePanel'
import { ErrorNotice } from './ui'

export function SentenceAudio({ sentence: s, source }: { sentence: Sentence; source: Source }) {
  const audio = useRef<HTMLAudioElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const peaks = useRef<{ rate: number; peaks: number[]; duration: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [time, setTime] = useState(s.start ?? 0)
  const [duration, setDuration] = useState(source.duration ?? 0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [loop, setLoop] = useState(false)
  const [speed, setSpeed] = useState('1')
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const drag = useRef<{ pointer: number; x: number; time: number; moved: boolean; previous: [number, number] | null } | null>(null)
  const clipEnd = s.end ?? duration
  const clipStart = s.start ?? 0
  const from = clipStart
  const to = clipEnd
  const clipDuration = Math.max(0, clipEnd - clipStart)
  const rangeStart = selection ? Math.max(clipStart, Math.min(clipEnd, selection[0])) : clipStart
  const rangeEnd = selection ? Math.max(rangeStart, Math.min(clipEnd, selection[1])) : clipEnd
  useEffect(() => {
    const a = audio.current
    if (!a) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = () => clearTimeout(timer)
    const enforce = () => {
      clear()
      if (rangeEnd <= rangeStart) return
      if (a.currentTime < rangeStart) a.currentTime = rangeStart
      if (a.currentTime >= rangeEnd) {
        if (loop && !a.paused) a.currentTime = rangeStart
        else {
          a.pause()
          if (a.currentTime !== rangeEnd) a.currentTime = rangeEnd
        }
      }
      setTime(a.currentTime)
      if (!a.paused) timer = setTimeout(enforce, Math.max(0, (rangeEnd - a.currentTime) / a.playbackRate * 1000))
    }
    const play = () => {
      if (a.currentTime < rangeStart || a.currentTime >= rangeEnd) a.currentTime = rangeStart
      enforce()
    }
    a.addEventListener('play', play)
    for (const event of ['seeking', 'timeupdate', 'ratechange']) a.addEventListener(event, enforce)
    a.addEventListener('pause', clear)
    enforce()
    return () => {
      clear()
      a.removeEventListener('play', play)
      for (const event of ['seeking', 'timeupdate', 'ratechange']) a.removeEventListener(event, enforce)
      a.removeEventListener('pause', clear)
    }
  }, [rangeStart, rangeEnd, loop])
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
      if (selection) {
        g.fillStyle = ink; g.globalAlpha = .18
        g.fillRect(x(rangeStart), 0, x(rangeEnd) - x(rangeStart), height)
      }
      g.globalAlpha = 1
      for (let k = 0; k < width; k += 3) {
        const t = from + k / width * span
        let peak = 0
        const a = Math.floor(t * p.rate), b = Math.max(a + 1, Math.ceil((t + 3 / width * span) * p.rate))
        for (let j = a; j < b; j++) peak = Math.max(peak, p.peaks[j] ?? 0)
        g.fillStyle = t >= rangeStart && t <= rangeEnd ? ink : faint
        const h = Math.max(2, peak * height * .9)
        g.fillRect(k, (height - h) / 2, 2, h)
      }
      if (selection) {
        g.fillStyle = ink
        g.fillRect(x(rangeStart), 0, 2, height)
        g.fillRect(Math.min(width - 2, x(rangeEnd)), 0, 2, height)
      }
      g.fillStyle = ink; g.fillRect(x(time), 0, 2, height)
    }
    draw()
    const resize = new ResizeObserver(draw); resize.observe(c)
    return () => resize.disconnect()
  }, [loaded, from, to, time, s.start, clipEnd, selection, rangeStart, rangeEnd])
  const seek = (t: number) => { const bounded = Math.max(rangeStart, Math.min(rangeEnd, t)); if (audio.current) audio.current.currentTime = bounded; setTime(bounded) }
  const toggle = () => {
    const a = audio.current
    if (!a || !ready || clipDuration <= 0) return
    if (!a.paused) a.pause()
    else {
      if (a.currentTime >= rangeEnd || a.currentTime < rangeStart) seek(rangeStart)
      void a.play().catch(setError)
    }
  }
  const selectRange = (a: number, b: number) => {
    if (clipDuration <= 0) return
    const start = Math.max(clipStart, Math.min(clipEnd, Math.min(a, b)))
    const end = Math.max(start, Math.min(clipEnd, Math.max(a, b)))
    if (end - start < Math.min(.01, clipDuration)) return
    audio.current?.pause()
    if (audio.current) audio.current.currentTime = start
    setTime(start)
    setSelection([start, end])
  }
  const pointerTime = (element: HTMLCanvasElement, x: number) => {
    const r = element.getBoundingClientRect()
    return clipStart + Math.max(0, Math.min(1, (x - r.left) / r.width)) * clipDuration
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"]')) return
      if (!ready || clipDuration <= 0) return
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) toggle() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        seek((audio.current?.currentTime ?? clipStart) + (e.key === 'ArrowLeft' ? -1 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return <section className="sentence-audio" aria-label="Sentence audio">
    <div className="sentence-section-head"><h2>Sentence audio</h2><span className="meta num">{fmtTime(clipDuration)}</span></div>
    {error != null && <ErrorNotice error={error} />}
    {!loaded ? <p role="status" className="meta">Drawing the waveform…</p> : <canvas ref={canvas} className="sentence-wave" role="img" aria-label="Sentence waveform. Drag to select audio, or use the selection start and end sliders below." onPointerDown={e => {
      if (e.button !== 0 || !ready || clipDuration <= 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { pointer: e.pointerId, x: e.clientX, time: pointerTime(e.currentTarget, e.clientX), moved: false, previous: selection }
    }} onPointerMove={e => {
      const d = drag.current
      if (!d || d.pointer !== e.pointerId) return
      if (Math.abs(e.clientX - d.x) >= 4) d.moved = true
      if (d.moved) selectRange(d.time, pointerTime(e.currentTarget, e.clientX))
    }} onPointerUp={e => {
      const d = drag.current
      if (!d || d.pointer !== e.pointerId) return
      drag.current = null
      if (d.moved) selectRange(d.time, pointerTime(e.currentTarget, e.clientX))
      else seek(d.time)
      e.currentTarget.releasePointerCapture(e.pointerId)
    }} onPointerCancel={() => {
      if (drag.current) setSelection(drag.current.previous)
      drag.current = null
    }} />}
    <label className="sentence-seek"><span className="sr">{selection ? 'Seek within selection' : 'Seek within sentence'}</span><input type="range" min={rangeStart - clipStart} max={rangeEnd - clipStart} step="0.01" disabled={!ready || clipDuration <= 0} value={Math.max(rangeStart, Math.min(rangeEnd, time)) - clipStart} onChange={e => seek(clipStart + Number(e.target.value))} onKeyDown={e => {
      if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) toggle() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek((audio.current?.currentTime ?? clipStart) + (e.key === 'ArrowLeft' ? -1 : 1)) }
    }} aria-valuetext={`${fmtTime(Math.max(0, time - clipStart))} of ${fmtTime(clipDuration)}`} /></label>
    <div className="times num"><span>{fmtTime(Math.max(0, Math.min(clipDuration, time - clipStart)))}</span><span>{fmtTime(clipDuration)}</span></div>
    <audio ref={audio} src={source.media!} preload="metadata" onLoadedMetadata={e => { setDuration(e.currentTarget.duration); e.currentTarget.currentTime = clipStart; e.currentTarget.playbackRate = Number(speed); setReady(true) }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setReady(false); setPlaying(false); setError(new Error('Audio could not be loaded. Reload the page to try again.')) }} onEnded={() => { setPlaying(false); if (loop && audio.current) { seek(rangeStart); void audio.current.play().catch(setError) } }} />
    <fieldset className="sentence-selection" disabled={!ready || clipDuration <= 0}>
      <legend>Audio selection</legend>
      <label>Start <output className="num">{(rangeStart - clipStart).toFixed(2)}s</output>
        <input type="range" min="0" max={Math.max(0, rangeEnd - clipStart - .01)} step="0.01" value={rangeStart - clipStart} onChange={e => selectRange(clipStart + Number(e.target.value), rangeEnd)} aria-label="Selection start" aria-valuetext={`${(rangeStart - clipStart).toFixed(2)} seconds into sentence`} />
      </label>
      <label>End <output className="num">{(rangeEnd - clipStart).toFixed(2)}s</output>
        <input type="range" min={Math.min(clipDuration, rangeStart - clipStart + .01)} max={clipDuration} step="0.01" value={rangeEnd - clipStart} onChange={e => selectRange(rangeStart, clipStart + Number(e.target.value))} aria-label="Selection end" aria-valuetext={`${(rangeEnd - clipStart).toFixed(2)} seconds into sentence`} />
      </label>
      {selection && <button className="btn small ghost" onClick={() => { audio.current?.pause(); setSelection(null) }}>Clear selection</button>}
    </fieldset>
    <div className="sentence-audio-controls">
      <button className="btn primary sentence-play" disabled={!ready || clipDuration <= 0} onClick={toggle}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? 'Pause' : selection ? 'Play selection' : 'Play sentence'}</button>
      <button className="btn" disabled={!ready || clipDuration <= 0} onClick={() => seek(rangeStart)}><RotateCcw aria-hidden="true" />Restart</button>
      <label className="sentence-toggle"><input className="check" type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Repeat</label>
      <label className="sentence-speed">Speed <select className="select" value={speed} onChange={e => { setSpeed(e.target.value); if (audio.current) audio.current.playbackRate = Number(e.target.value) }}>{['0.5', '0.75', '1', '1.25'].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>
    </div>
    <p className="meta">Space: play / pause · Left / right arrows: seek 1 second. Click the waveform to seek; drag across it to select a part. Selection times are relative to the sentence.</p>
  </section>
}
