import { ChevronLeft, ChevronRight, Mic, Square, Volume2, RotateCcw, AudioLines, Bot, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, allSentences, type Score, type Sentence } from '../lib/api'
import { Recorder, playClip, speak, stopAudio } from '../lib/audio'
import { Balloon } from '../components/Balloon'
import { Furigana, Units } from '../components/Furigana'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamp, Stamps } from '../components/Stamp'
import { ErrorNotice, Skeleton, useAsync, usePref, useToast, shortcutBlocked } from '../components/ui'
import { useStats } from '../App'

export default function PracticePage() {
  const [params] = useSearchParams()
  const sentence = Number(params.get('sentence')) || undefined
  const deck = Number(params.get('deck')) || undefined
  const source = Number(params.get('source')) || undefined
  const ids = params.get('ids')?.split(',').map(Number).filter(Boolean)
  const { data, error, loading } = useAsync(async () => {
    if (sentence) {
      const s = await api.sentence(sentence)
      return { title: 'Sentence practice', back: `/sentences/${s.id}`, sentences: [s] }
    }
    if (deck) {
      const [d, s] = await Promise.all([api.deck(deck), allSentences({ deck })])
      return { title: d.name, back: `/decks/${deck}`, sentences: s.results }
    }
    if (source) {
      const s = await api.source(source)
      return { title: s.title || 'Source', back: `/sources/${source}`, sentences: s.sentences }
    }
    const pick = ids ? await Promise.all([...new Set(ids)].map((id) => api.sentence(id))) : (await api.sentences({ limit: 20 })).results
    return { title: 'Selected sentences', back: '/library', sentences: pick }
  }, [sentence, deck, source, params.get('ids')])

  if (error) return <ErrorNotice error={error} />
  if (loading || !data) return <Skeleton rows={3} />
  return <PracticeSession key={params.toString()} title={data.title} back={data.back} sentences={data.sentences} />
}

type Result = Score & { model: 'native' | 'tts' | 'none' }

/** One practice run through a list of sentences: listen to the model, say it, see the score. */
export function PracticeSession({ title, back, sentences: initial, onFinish }: {
  title: string; back: string; sentences: Sentence[]; onFinish?: () => void
}) {
  const [sentences, setSentences] = useState(initial)
  const [i, setI] = useState(0)
  const [results, setResults] = useState<Record<number, Result>>({})
  const [recording, setRecording] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState<{ sentence: Sentence; result: Result } | null>(null)
  const [saving, setSaving] = useState(false)
  const [model, setModel] = usePref<'native' | 'tts'>('model', 'native')
  const [voice, setVoice] = usePref<string>('voice', 'browser')
  const [along, setAlong] = usePref('along', false)
  const [furigana, setFurigana] = usePref('furigana', true)
  const [engine, setEngine] = useState<'unknown' | 'ready' | 'loading' | 'idle' | 'off' | 'error' | 'missing'>('unknown')
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const rec = useRef(new Recorder())
  const starting = useRef(false)
  const levelRef = useRef<HTMLElement>(null)
  const toast = useToast()
  const { refresh } = useStats()

  const s = sentences[i]
  const res = s ? results[s.id] : undefined
  const canNative = !!s?.has_audio
  const useNative = model === 'native' && canNative
  const done = i >= sentences.length

  // the scoring engine (Whisper) and the voices
  useEffect(() => {
    let live = true
    const poll = () => api.engineStatus().then(
      (st) => { if (live) setEngine(st.state) },
      () => { if (live) setEngine('off') })
    poll()
    const t = window.setInterval(poll, 5000)
    api.voices().then((v) => live && setVoices(v.voices), () => {})
    return () => { live = false; window.clearInterval(t) }
  }, [])

  rec.current.onLevel = (rms) => { if (levelRef.current) levelRef.current.style.transform = `scaleX(${Math.min(1, rms * 9)})` }

  const listen = useCallback(async () => {
    if (!s || scoring) return
    if (playing) { stopAudio(); return }
    setErr(null); setPlaying(true)
    try {
      if (useNative) {
        const src = await api.source(s.source)
        await playClip(src.media!, s.start!, s.end!, setPlayhead)
      } else {
        await speak(s.text, voice, 1)
      }
    } catch (e) { setErr((e as Error).message) }
    finally { setPlaying(false); setPlayhead(null) }
  }, [s, useNative, voice, scoring, playing])

  const startRec = useCallback(async () => {
    if (!s || starting.current || rec.current.active || scoring || saving || engine === 'loading') return
    starting.current = true; setErr(null); setUnsaved(null)
    try {
      await rec.current.start()
      setRecording(true)
      if (along) listen()
    } catch (e) {
      const name = (e as Error).name
      setErr(name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in the browser’s site settings.'
        : name === 'NotFoundError' ? 'No microphone found.' : !window.isSecureContext ? 'The microphone needs HTTPS (or localhost). Open kotoba through tailscale serve.' : (e as Error).message)
    } finally { starting.current = false }
  }, [s, along, listen, scoring, saving, engine])

  const save = useCallback(async (sentence: Sentence, r: Result) => {
    setSaving(true); setErr(null)
    try {
      const out = await api.attempt({ sentence: sentence.id, model: r.model, overall: r.overall, accuracy: r.accuracy,
        clarity: r.clarity, fluency: r.fluency, said: r.said, units: r.units })
      setResults((m) => ({ ...m, [sentence.id]: r }))
      setSentences((list) => list.map((x) => (x.id === sentence.id ? out.sentence : x)))
      setUnsaved(null); refresh()
    } catch (e) { setUnsaved({ sentence, result: r }); setErr('The score was not saved: ' + (e as Error).message) } finally { setSaving(false) }
  }, [refresh])

  const stopRec = useCallback(async () => {
    if (!rec.current.active || !s) return
    stopAudio()
    const { pcm, seconds } = rec.current.stop()
    setRecording(false)
    if (levelRef.current) levelRef.current.style.transform = 'scaleX(0)'
    if (seconds < 0.4) { setErr('That was too short to score. Hold the take a little longer.'); return }
    if (engine !== 'ready') return // self-grade instead
    setScoring(true)
    try {
      const score = await api.score(pcm, s.text)
      await save(s, { ...score, model: useNative ? 'native' : 'tts' })
    } catch (e) { setErr((e as Error).message) }
    finally { setScoring(false) }
  }, [s, engine, save, useNative])

  useEffect(() => {
    rec.current.onAutoStop = () => { void stopRec() }
  }, [stopRec])

  const loadEngine = async () => {
    setEngine('loading'); setErr(null)
    try { setEngine((await api.engineLoad()).state) }
    catch (e) { setEngine('error'); setErr((e as Error).message) }
  }

  const selfGrade = (overall: number) => s && save(s, {
    said: '', overall, accuracy: overall, clarity: overall, fluency: overall, units: [], missed: [], unclear: [], extra: [], fillers: [], model: 'none',
  })

  const go = useCallback((d: number) => {
    if (recording || scoring || saving || rec.current.active) return
    stopAudio(); setPlaying(false); setPlayhead(null)
    setErr(null)
    setI((x) => Math.max(0, Math.min(sentences.length, x + d)))
  }, [sentences.length, recording, scoring, saving])

  // keyboard: L listen, Space record/stop, N/→ next, P/← previous, F furigana
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e) || done || scoring || saving) return
      if (e.key === ' ') { e.preventDefault(); if (recording) stopRec(); else if (!scoring) startRec() }
      else if (e.key === 'l') listen()
      else if (e.key === 'n' || e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'p' || e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'f') setFurigana(!furigana)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, scoring, startRec, stopRec, listen, go, furigana, setFurigana, done, saving])
  useEffect(() => () => { stopAudio(); if (rec.current.active) rec.current.stop() }, [])

  if (!sentences.length) {
    return (
      <div className="empty">
        <h2>Nothing to practise here</h2>
        <p>Add sentences to this deck from the library or the inbox.</p>
        <Link className="btn" to={back}>Back</Link>
      </div>
    )
  }

  const shape = recording ? 'burst' : res?.unclear.length ? 'dashed' : 'round'

  return (
    <>
      <header className="page-head practice-head">
        <Link className="btn icon ghost" to={back} aria-label="Back"><ChevronLeft aria-hidden="true" /></Link>
        <h1>{title} <span className="meta num">{done ? 'Finished' : `${i + 1} / ${sentences.length}`}</span></h1>
        <span className="grow" />
        <EngineLine engine={engine} onLoad={loadEngine} />
      </header>

      <div className="deck-progress" aria-hidden="true" style={{ marginBottom: 'var(--s-5)' }}>
        {sentences.map((x, k) => {
          const r = results[x.id]
          return <i key={x.id} className={k === i ? 'now' : r ? (r.overall < 70 ? 'weak' : 'done') : ''} />
        })}
      </div>

      {done ? (
        <Summary sentences={sentences} results={results} back={back}
          again={(weak) => { setSentences(weak); setResults({}); setI(0) }} onFinish={onFinish} toast={toast} />
      ) : (
        <div className="practice">
          <div className="source-panel">
            {canNative ? <WavePanel s={s} playhead={playhead} /> :
              <SourcePanel big kind={s.source_kind} image={s.image} start={s.start} end={s.end} alt={s.text} />}
            <div className="btn-row" role="group" aria-label="Model voice">
              <div className="seg">
                <label><input type="radio" name="model" checked={useNative} disabled={!canNative} onChange={() => setModel('native')} /><span><AudioLines aria-hidden="true" />Native</span></label>
                <label><input type="radio" name="model" checked={!useNative} onChange={() => setModel('tts')} /><span><Bot aria-hidden="true" />Voice</span></label>
              </div>
              {!useNative && (
                <label><span className="sr">Synthetic voice</span>
                  <select className="select" style={{ width: 'auto', height: 32, minHeight: 0, paddingBlock: 0 }} value={voice} onChange={(e) => setVoice(e.target.value)}>
                    <option value="browser">Browser voice</option>
                    {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!canNative && <p className="meta">{s.source_kind === 'capture' ? 'From a screen capture: no native audio, so the synthetic voice reads it.' : 'This sentence has no timed audio.'}</p>}
            <p className="meta"><Link to={`/sources/${s.source}`}>{s.source_title}</Link>{s.start != null && <> · <span className="num">{fmtTime(s.start)}</span></>}</p>
          </div>

          <div className="stage">
            <div className="strip">
              {i > 0 && (
                <button className="btn ghost" style={{ justifySelf: 'start', height: 'auto', padding: 0, fontWeight: 400 }} disabled={recording || scoring || saving} onClick={() => go(-1)} aria-label="Previous sentence">
                  <Balloon dim tail="none"><Furigana text={sentences[i - 1].text} pairs={[]} show={false} /></Balloon>
                </button>
              )}
              <Balloon big shape={shape} live={recording} className="focus-balloon">
                <span className="text" aria-live="polite">
                  {res && res.units.length ? <Units units={res.units} pairs={s.furigana} show={furigana} /> : <Furigana text={s.text} pairs={s.furigana} show={furigana} />}
                </span>
              </Balloon>
              {i < sentences.length - 1 && (
                <button className="btn ghost next" style={{ height: 'auto', padding: 0, fontWeight: 400 }} disabled={recording || scoring || saving} onClick={() => go(1)} aria-label="Next sentence">
                  <Balloon dim tail="none">{sentences[i + 1].text}</Balloon>
                </button>
              )}
            </div>

            <div className="level" aria-hidden="true"><i ref={levelRef as never} /></div>

            <div className="controls">
              <button className="btn" onClick={listen} disabled={recording || scoring || saving} aria-busy={playing}>
                <Volume2 aria-hidden="true" />{playing ? 'Stop audio' : 'Listen'}
              </button>
              <button className={'btn rec ' + (recording ? 'red on' : 'red')} onClick={recording ? stopRec : startRec} disabled={scoring || saving || (engine === 'loading' && !recording)} aria-busy={scoring || engine === 'loading'} aria-pressed={recording}>
                {recording ? <Square aria-hidden="true" /> : scoring || engine === 'loading' ? <LoaderCircle className="loading-spinner" aria-hidden="true" /> : <Mic aria-hidden="true" />}
                {scoring ? 'Scoring…' : recording ? 'Stop' : engine === 'loading' ? 'Loading Whisper…' : res ? 'Say it again' : 'Say it'}
              </button>
              <button className="btn primary" disabled={recording || scoring || saving} onClick={() => go(1)}>Next<ChevronRight aria-hidden="true" /></button>
            </div>

            {err && <ErrorNotice error={err} action={unsaved && <button className="btn small" disabled={saving} onClick={() => save(unsaved.sentence, unsaved.result)}>Retry saving score</button>} />}

            {res ? <ResultBlock r={res} s={s} /> : engine !== 'ready' && engine !== 'unknown' && engine !== 'loading' && (
              <div className="self-grade" role="group" aria-label="Grade yourself">
                <span className="meta">No scoring engine. Grade yourself after saying it:</span>
                <button className="btn small" disabled={saving} onClick={() => selfGrade(30)}>Again</button>
                <button className="btn small" disabled={saving} onClick={() => selfGrade(65)}>Hard</button>
                <button className="btn small" disabled={saving} onClick={() => selfGrade(82)}>Good</button>
                <button className="btn small" disabled={saving} onClick={() => selfGrade(96)}>Easy</button>
              </div>
            )}

            <div className="hints">
              <span>Stops automatically after 1.5 seconds of silence</span>
              <span><kbd className="kbd">L</kbd> listen</span>
              <span><kbd className="kbd">Space</kbd> record / stop</span>
              <span><kbd className="kbd">N</kbd> next</span>
              <span><kbd className="kbd">F</kbd> furigana</span>
              </div>
            <div className="practice-settings"><label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" className="check" style={{ width: 14, height: 14 }} checked={along} onChange={(e) => setAlong(e.target.checked)} />
                Speak along (play the model while recording)
              </label>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ResultBlock({ r, s }: { r: Result; s: Sentence }) {
  return (
    <section className="result" aria-label="Score">
      <Stamp big land s={{ id: s.id + r.overall, overall: r.overall, accuracy: r.accuracy, clarity: r.clarity, fluency: r.fluency }} />
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <dl>
          <div><dt>Accuracy</dt><dd>{r.accuracy}</dd></div>
          <div><dt>Clarity</dt><dd>{r.clarity}</dd></div>
          <div><dt>Fluency</dt><dd>{r.fluency}</dd></div>
        </dl>
        {r.model !== 'none' && (
          <div className="heard">
            <p><span className="feedback-label">Heard</span><b lang="ja">{r.said || '(nothing)'}</b></p>
            {r.missed.length > 0 && <p><span className="feedback-label">Missed</span><span className="unit missed" lang="ja">{r.missed.join('、')}</span></p>}
            {r.unclear.length > 0 && <p><span className="feedback-label">Unclear</span><span className="unit unclear" lang="ja">{r.unclear.join('、')}</span></p>}
            {r.fillers.length > 0 && <p><span className="feedback-label">Fillers</span><span lang="ja">{r.fillers.join('、')}</span></p>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}><span className="meta">Earlier</span><Stamps stamps={s.stamps.slice(1)} max={8} /></div>
      </div>
    </section>
  )
}

function EngineLine({ engine, onLoad }: { engine: string; onLoad: () => Promise<void> }) {
  const text = {
    unknown: 'Checking the scoring engine…', ready: 'Scoring ready', loading: 'Loading Whisper…',
    idle: 'Load Whisper to get scores', off: 'Scoring needs Whisper, which isn\'t available',
    error: 'Whisper failed to load: scoring needs it',
    missing: 'Scoring needs Whisper, which isn\'t installed. Grade yourself for now',
  }[engine]
  const cls = engine === 'ready' ? 'ok' : engine === 'loading' || engine === 'idle' ? 'warn' : 'off'
  return (
    <span className="engine-line" role="status">
      {engine === 'loading' ? <LoaderCircle className="loading-spinner" size={16} aria-hidden="true" /> : <span className={'dot ' + cls} aria-hidden="true" />}<span className="engine-text">{text}</span>
      {(engine === 'idle' || engine === 'error') && (
        <button className="btn small" onClick={onLoad}>Load Whisper</button>
      )}
      {(engine === 'off' || engine === 'missing') && <Link to="/addons">Set up</Link>}
    </span>
  )
}

/** The native clip's waveform, with the sentence span marked and a playhead. */
function WavePanel({ s, playhead }: { s: Sentence; playhead: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<{ rate: number; duration: number; peaks: number[] } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setPeaks(null); setFailed(false)
    api.peaks(s.source).then((p) => live && setPeaks(p), () => live && setFailed(true))
    return () => { live = false }
  }, [s.source])
  useEffect(() => {
    const c = canvas.current
    if (!c || !peaks || s.start == null || s.end == null) return
    const draw = () => {
    const pad = 0.4, a = Math.max(0, s.start! - pad), b = Math.min(peaks.duration, s.end! + pad)
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight
    c.width = w * dpr; c.height = h * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    const css = getComputedStyle(c)
    const ink = css.getPropertyValue('--ink').trim(), faint = css.getPropertyValue('--ink-3').trim()
    const data = peaks.peaks, rate = peaks.rate
    const bars = Math.floor(w / 3)
    for (let k = 0; k < bars; k++) {
      const t0 = a + ((b - a) * k) / bars, t1 = a + ((b - a) * (k + 1)) / bars
      let peak = 0
      for (let j = Math.floor(t0 * rate); j < Math.floor(t1 * rate); j++) peak = Math.max(peak, Math.abs(data[j] || 0))
      const inSpan = t0 >= s.start! && t1 <= s.end!
      const played = playhead != null && t1 <= playhead
      g.fillStyle = inSpan ? (played ? faint : ink) : faint
      g.globalAlpha = inSpan ? 1 : 0.4
      const bh = Math.max(1.5, peak * h * 0.95)
      g.fillRect(k * 3, (h - bh) / 2, 2, bh)
    }
    }
    draw()
    const resize = new ResizeObserver(draw); resize.observe(c)
    return () => resize.disconnect()
  }, [peaks, s.start, s.end, playhead])
  return (
    <div className="panel big wave-panel" style={{ aspectRatio: 'auto' }}>
      <span className="kind">{s.source_kind === 'video' ? 'Video' : 'Audio'}</span>
      <div style={{ height: 8 }} />
      {!peaks && !failed && <p className="meta" role="status">Drawing the waveform…</p>}
      {failed ? <p className="meta">The waveform could not be drawn. You can still listen to the clip.</p> : <canvas ref={canvas} role="img" aria-label="Waveform of the native clip" />}
      <div className="times num"><span>{fmtTime(s.start)}</span><span>{s.end != null && s.start != null ? `${(s.end - s.start).toFixed(1)} s` : ''}</span><span>{fmtTime(s.end)}</span></div>
    </div>
  )
}

function Summary({ sentences, results, back, again, onFinish, toast }: {
  sentences: Sentence[]; results: Record<number, Result>; back: string; again: (weak: Sentence[]) => void
  onFinish?: () => void; toast: (t: { text: string }) => void
}) {
  const scored = sentences.filter((s) => results[s.id])
  const avg = scored.length ? Math.round(scored.reduce((n, s) => n + results[s.id].overall, 0) / scored.length) : null
  const weak = scored.filter((s) => results[s.id].overall < 70)
  useEffect(() => { if (scored.length) toast({ text: `${scored.length} attempts stamped` }) }, []) // eslint-disable-line
  return (
    <section className="empty" style={{ maxWidth: '44rem' }}>
      <h2>{scored.length ? 'Session done' : 'Session finished'}</h2>
      <p>{scored.length ? `${scored.length} of ${sentences.length} sentences said${avg !== null ? `, average ${avg}` : ''}. Weak ones come back in Review.` : 'Nothing was recorded this time.'}</p>
      {weak.length > 0 && (
        <div className="strip" style={{ width: '100%' }}>
          {weak.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              <Balloon tail="none"><Units units={results[s.id].units.length ? results[s.id].units : [{ text: s.text, status: 'ok', conf: null }]} /></Balloon>
              <Stamp s={{ id: s.id, ...results[s.id] }} />
            </div>
          ))}
        </div>
      )}
      <div className="btn-row">
        {weak.length > 0 && <button className="btn primary" onClick={() => again(weak)}><RotateCcw aria-hidden="true" />Practise the {weak.length} weak ones</button>}
        <button className="btn" onClick={() => again(sentences)}>Start over</button>
        {onFinish ? <button className="btn primary" onClick={onFinish}>Done</button> : <Link className="btn primary" to={back}>Done</Link>}
      </div>
    </section>
  )
}
