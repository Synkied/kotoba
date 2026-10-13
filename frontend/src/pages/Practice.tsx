import { AlertTriangle, ChevronLeft, Link2, ChevronRight, Mic, Square, Volume2, RotateCcw, X, AudioLines, Bot, LoaderCircle, Play, ArrowLeftRight, Bookmark, BookmarkCheck, Download } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, allSentences, type Score, type Sentence, type Stamp as StampT } from '../lib/api'
import { Recorder, playClip, playUrl, speak, stopAudio, wav } from '../lib/audio'
import { Balloon } from '../components/Balloon'
import { Furigana, Units } from '../components/Furigana'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamp, Stamps } from '../components/Stamp'
import { ErrorNotice, Skeleton, useAsync, usePref, useToast, useVoiceLoading, shortcutBlocked } from '../components/ui'
import { useStats } from '../App'
import { MeaningHint, ReadingAids, useAids } from '../components/ReadingAids'
import { Button, ButtonLink, ButtonRow, buttonClass, ChipButton, EmptyState, Kbd, Notice, Panel, Segmented, Select } from '../components/ds'

export default function PracticePage() {
  const [params, setParams] = useSearchParams()
  const sentence = Number(params.get('sentence')) || undefined
  const deck = Number(params.get('deck')) || undefined
  const source = Number(params.get('source')) || undefined
  const ids = params.get('ids')?.split(',').map(Number).filter(Boolean)
  const { data, error, loading } = useAsync(async () => {
    if (sentence) {
      const s = await api.sentence(sentence)
      const back = params.get('from') === 'source' ? `/sources/${s.source}` : `/sentences/${s.id}`
      return { title: 'Sentence practice', back, sentences: [s] }
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
    return { title: 'Selected sentences', back: '/sources', sentences: pick }
  }, [sentence, deck, source, params.get('ids')])

  if (error) return <ErrorNotice error={error} />
  if (loading || !data) return <Skeleton rows={3} />
  // ?at=<sentence id> opens the run on that sentence and follows along, so the address is always a link to it
  const run = new URLSearchParams(params); run.delete('at')
  const onAt = (id: number | null) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (id == null) next.delete('at'); else next.set('at', String(id))
    return next
  }, { replace: true })
  return <PracticeSession key={run.toString()} title={data.title} back={data.back} sentences={data.sentences}
    startAt={Number(params.get('at')) || undefined} onAt={onAt} />
}

type Result = Score & { model: 'native' | 'tts' | 'none' }
/** the last take of a sentence, to hear back; attempt is its saved score, once there is one */
type Take = { pcm: Int16Array; attempt: number | null; kept: boolean }

/** One practice run through a list of sentences: listen to the model, say it, see the score. */
export function PracticeSession({ title, back, sentences: initial, onFinish, startAt, onAt }: {
  title: string; back: string; sentences: Sentence[]; onFinish?: () => void
  startAt?: number; onAt?: (id: number | null) => void
}) {
  const [sentences, setSentences] = useState(initial)
  const [i, setI] = useState(() => Math.max(0, initial.findIndex((x) => x.id === startAt)))
  const [results, setResults] = useState<Record<number, Result>>({})
  const [recording, setRecording] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState<{ sentence: Sentence; result: Result } | null>(null)
  const [saving, setSaving] = useState(false)
  const [takes, setTakes] = useState<Record<number, Take>>({})
  const [hearing, setHearing] = useState<'take' | 'compare' | null>(null)
  const [keeping, setKeeping] = useState(false)
  const hearRun = useRef(0)  // bumped to cut a take (or a compare) short
  const [model, setModel] = usePref<'native' | 'tts'>('model', 'native')
  const [voice, setVoice] = usePref<string>('voice', 'browser')
  const [along, setAlong] = usePref('along', false)
  const aids = useAids()
  const { furigana, setFurigana, roman, setRoman, translation, setTranslation } = aids
  const [meaningFor, setMeaningFor] = useState<number | null>(null)  // the sentence whose meaning is unfolded
  const [engine, setEngine] = useState<'unknown' | 'ready' | 'loading' | 'idle' | 'off' | 'error' | 'missing'>('unknown')
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const rec = useRef(new Recorder())
  const starting = useRef(false)
  const levelRef = useRef<HTMLElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const voiceLoading = useVoiceLoading()
  const { refresh } = useStats()

  const s = sentences[i]
  const res = s ? results[s.id] : undefined
  const take = s ? takes[s.id] : undefined
  const canNative = !!s?.has_audio
  const useNative = model === 'native' && canNative
  const done = i >= sentences.length

  useEffect(() => { onAt?.(s ? s.id : null) }, [s?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // a fresh score: where the page stacks (phones, tablets) bring it into view; beside the stage it already is
  useEffect(() => {
    if (!res) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    slot.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }, [res])

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ text: 'Link to this sentence copied' }) }
    catch { toast({ text: 'Copy the link from your address bar' }) }
  }

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

  const playModel = useCallback(async () => {
    if (!s) return
    if (useNative) {
      const src = await api.source(s.source)
      await playClip(src.media!, s.start!, s.end!, setPlayhead)
    } else {
      await speak(s.text, voice, 1, undefined, s.id)
    }
  }, [s, useNative, voice])

  // stop any take playing: before recording, so the speakers don't end up in the new take
  const hush = () => { hearRun.current++; setHearing(null); stopAudio() }

  const listen = useCallback(async () => {
    if (!s || scoring) return
    if (playing) { stopAudio(); return }
    hush(); setErr(null); setPlaying(true)
    try { await playModel() } catch (e) { setErr((e as Error).message) }
    finally { setPlaying(false); setPlayhead(null) }
  }, [s, scoring, playing, playModel])

  // your last take on its own, or the model and then your take, to hear where they part
  const hear = useCallback(async (compare: boolean) => {
    if (!take || recording || scoring) return
    if (hearing) { hush(); return }
    const run = ++hearRun.current
    setErr(null); setHearing(compare ? 'compare' : 'take')
    const url = URL.createObjectURL(wav(take.pcm))
    try {
      if (compare) {
        await playModel(); setPlayhead(null)
        if (hearRun.current !== run) return
        await new Promise((r) => window.setTimeout(r, 350))
        if (hearRun.current !== run) return
      }
      await playUrl(url)
    } catch (e) { if (hearRun.current === run) setErr((e as Error).message) }
    finally { URL.revokeObjectURL(url); if (hearRun.current === run) { setHearing(null); setPlayhead(null) } }
  }, [take, recording, scoring, hearing, playModel])

  // keep the take with its score, to hear it again in later sessions; or let it go
  const toggleKeep = useCallback(async () => {
    if (!s || !take || take.attempt == null || keeping) return
    const id = s.id, attempt = take.attempt
    setKeeping(true); setErr(null)
    try {
      const audio = take.kept ? (await api.dropTake(attempt), null) : (await api.keepTake(attempt, take.pcm)).audio
      setTakes((m) => ({ ...m, [id]: { ...take, kept: !!audio } }))
      setSentences((list) => list.map((x) => (x.id === id ? { ...x, stamps: x.stamps.map((st) => (st.id === attempt ? { ...st, audio } : st)) } : x)))
      toast({ text: audio ? 'Take kept. It stays with this score in the sentence’s history.' : 'Take let go. The score stays.' })
    } catch (e) { setErr((take.kept ? 'The take was not let go: ' : 'The take was not kept: ') + (e as Error).message) }
    finally { setKeeping(false) }
  }, [s, take, keeping, toast])

  const startRec = useCallback(async () => {
    if (!s || starting.current || rec.current.active || scoring || saving || engine === 'loading') return
    starting.current = true; setErr(null); setUnsaved(null); hush()
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
      // the take this score is for can now be kept with it
      setTakes((m) => (m[sentence.id]?.attempt === null ? { ...m, [sentence.id]: { ...m[sentence.id], attempt: out.attempt.id } } : m))
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
    // hear it back whatever happens next: a take that scored badly, or not at all, is the one worth hearing
    if (seconds > 0.1) setTakes((m) => ({ ...m, [s.id]: { pcm, attempt: null, kept: false } }))
    if (seconds < 0.4) { setErr('That was too short to score. Hold the take a little longer.'); return }
    if (engine !== 'ready') return // self-grade instead
    setScoring(true)
    try {
      const score = await api.score(pcm, s.text)
      if (!score.said.trim()) { setErr('No speech heard in that take. Say it again, a little closer to the microphone.'); return }
      await save(s, { ...score, model: useNative ? 'native' : 'tts' })
    } catch (e) { setErr((e as Error).message) }
    finally { setScoring(false) }
  }, [s, engine, save, useNative])

  // drop the take unscored, ready to say it again
  const discardRec = useCallback(() => {
    if (!rec.current.active) return
    stopAudio(); setPlaying(false); setPlayhead(null)
    rec.current.stop()
    setRecording(false); setErr(null)
    if (levelRef.current) levelRef.current.style.transform = 'scaleX(0)'
  }, [])

  const dismissErr = useCallback(() => { setErr(null); setUnsaved(null) }, [])

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
    hush(); setPlaying(false); setPlayhead(null)
    setErr(null)
    setI((x) => Math.max(0, Math.min(sentences.length, x + d)))
  }, [sentences.length, recording, scoring, saving])

  // keyboard: L listen, Space record/stop, Esc discard, M my take, C compare, K keep, N/→ next, P/← previous, F furigana, R romaji, T meaning
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc (discard the take, or put away an error) still works with the record button focused, which it is after a click
      const inField = e.target instanceof Element && !!e.target.closest('input, textarea, select, [role="dialog"]')
      if (e.key === 'Escape' && !e.defaultPrevented && !inField && (recording || err)) { e.preventDefault(); if (recording) discardRec(); else dismissErr(); return }
      if (shortcutBlocked(e) || done || scoring || saving) return
      if (e.key === ' ') { e.preventDefault(); if (recording) stopRec(); else if (!scoring) startRec() }
      else if (e.key === 'l') listen()
      else if (e.key === 'm') hear(false)
      else if (e.key === 'c') hear(true)
      else if (e.key === 'k') toggleKeep()
      else if (e.key === 'n' || e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'p' || e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'f') setFurigana(!furigana)
      else if (e.key === 'r') setRoman(!roman)
      else if (e.key === 't' && s) { if (!translation) setTranslation(true); setMeaningFor(meaningFor === s.id ? null : s.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, scoring, startRec, stopRec, discardRec, err, dismissErr, listen, hear, toggleKeep, go, furigana, setFurigana, roman, setRoman, translation, setTranslation, meaningFor, s, done, saving])
  useEffect(() => () => { stopAudio(); if (rec.current.active) rec.current.stop() }, [])

  if (!sentences.length) {
    return (
      <EmptyState>
        <h2>Nothing to practise here</h2>
        <p>Add sentences to this deck from Sources or the inbox.</p>
        <ButtonLink to={back}>Back</ButtonLink>
      </EmptyState>
    )
  }

  const shape = recording ? 'burst' : res?.unclear.length ? 'dashed' : 'round'

  return (
    <>
      <header className="page-head practice-head">
        <ButtonLink variant="ghost" icon to={back} aria-label="Back"><ChevronLeft aria-hidden="true" /></ButtonLink>
        <h1>{title} <span className="meta num">{done ? 'Finished' : `${i + 1} / ${sentences.length}`}</span></h1>
        <span className="grow" />
        {onAt && !done && <Button variant="ghost" size="small" onClick={copyLink} title="Copy a link that opens this practice on this sentence"><Link2 aria-hidden="true" />Copy link</Button>}
        <EngineLine engine={engine} onLoad={loadEngine} />
      </header>

      <div className="deck-progress" aria-hidden="true">
        {sentences.map((x, k) => {
          const r = results[x.id]
          return <i key={x.id} className={k === i ? 'now' : r ? (r.overall < 70 ? 'weak' : 'done') : ''} />
        })}
      </div>

      {done ? (
        <Summary sentences={sentences} results={results} back={back}
          again={(weak) => { setSentences(weak); setResults({}); setI(0) }} onFinish={onFinish} toast={toast} />
      ) : (<>
        {/* how the whole session reads and sounds: one bar, set once, never between the sentences */}
        <div className="practice-bar">
          <ReadingAids aids={aids} roman={sentences.some((x) => x.roman)} keys />
          <span className="grow" />
          <div className="practice-model" role="group" aria-label="Model voice">
            <Segmented name="model" value={useNative ? 'native' : 'tts'} onChange={setModel} options={[
              { value: 'native', label: <><AudioLines aria-hidden="true" />Native</>, disabled: !canNative },
              { value: 'tts', label: <><Bot aria-hidden="true" />Voice</> },
            ]} />
            {!useNative && (
              <label><span className="sr">Synthetic voice</span>
                <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  <option value="browser">Browser voice</option>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              </label>
            )}
          </div>
          <ChipButton type="button" aria-pressed={along} onClick={() => setAlong(!along)} title="Play the model while you record">Speak along</ChipButton>
        </div>

        <div className="practice">
          {/* the model, then how you did against it: the score lands where you can see it */}
          <aside className="practice-side">
            <div className="source-panel">
              {canNative ? <WavePanel s={s} playhead={playhead} /> :
                <SourcePanel big kind={s.source_kind} image={s.image} start={s.start} end={s.end} alt={s.text} />}
              {!canNative && <p className="meta">{s.source_kind === 'capture' ? 'From a screen capture: no native audio, so the synthetic voice reads it.' : 'This sentence has no timed audio.'}</p>}
              <p className="meta"><Link to={`/sources/${s.source}`}>{s.source_title}</Link>{s.start != null && <> · <span className="num">{fmtTime(s.start)}</span></>}</p>
            </div>

            <div className="score-slot" ref={slot}>
              {take && !recording && (
                <div className="take-bar" role="group" aria-label="Your last take">
                  <span className="feedback-label">Your take</span>
                  <Button size="small" onClick={() => hear(false)} disabled={scoring} aria-pressed={hearing === 'take'} title="Hear your last take (M)">
                    {hearing === 'take' ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}{hearing === 'take' ? 'Stop' : 'Hear it'}
                  </Button>
                  <Button size="small" onClick={() => hear(true)} disabled={scoring} aria-pressed={hearing === 'compare'} title="The model, then your take (C)">
                    {hearing === 'compare' ? <Square aria-hidden="true" /> : <ArrowLeftRight aria-hidden="true" />}{hearing === 'compare' ? 'Stop' : 'Compare'}
                  </Button>
                  <Button variant="ghost" size="small" icon onClick={() => saveFile(URL.createObjectURL(wav(take.pcm)), takeName(s, take.attempt != null ? res?.overall : undefined), true)}
                    aria-label="Download your take" title="Download your take as a WAV file">
                    <Download aria-hidden="true" />
                  </Button>
                  {take.attempt != null && (
                    <Button variant="ghost" size="small" onClick={toggleKeep} disabled={keeping} aria-pressed={take.kept}
                      title={take.kept ? 'Kept with this score. Click to let it go (K)' : 'Keep this take with its score, to hear it again later (K)'}>
                      {take.kept ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}{take.kept ? 'Kept' : 'Keep'}
                    </Button>
                  )}
                </div>
              )}
              {res ? <ResultBlock r={res} s={s} /> : s.stamps.length > 0 ? <History s={s} />
                : engine === 'ready' && <p className="meta score-empty">No tries yet. Say it to get a stamp.</p>}
              {!res && engine !== 'ready' && engine !== 'unknown' && engine !== 'loading' && (
                <div className="self-grade" role="group" aria-label="Grade yourself">
                  <span className="meta">No scoring engine. Grade yourself after saying it:</span>
                  <Button size="small" disabled={saving} onClick={() => selfGrade(30)}>Again</Button>
                  <Button size="small" disabled={saving} onClick={() => selfGrade(65)}>Hard</Button>
                  <Button size="small" disabled={saving} onClick={() => selfGrade(82)}>Good</Button>
                  <Button size="small" disabled={saving} onClick={() => selfGrade(96)}>Easy</Button>
                </div>
              )}
            </div>

            <Keys meaning={translation} />
          </aside>

          <div className="stage">
            {i > 0 && (
              <Button variant="ghost" className="neighbour" disabled={recording || scoring || saving} onClick={() => go(-1)} aria-label="Previous sentence">
                <Balloon dim tail="none"><span className="clip"><Furigana text={sentences[i - 1].text} pairs={[]} show={false} lookup={false} /></span></Balloon>
              </Button>
            )}
            <Balloon big shape={shape} live={recording} className="focus-balloon">
              <span className="text" aria-live="polite">
                {res && res.units.length ? <Units units={res.units} pairs={s.furigana} show={furigana} /> : <Furigana text={s.text} pairs={s.furigana} show={furigana} />}
              </span>
              {roman && s.roman && <span className="roman">{s.roman.split('\t')[0]}</span>}
              {translation && <MeaningHint s={s} open={meaningFor === s.id} onOpen={() => setMeaningFor(s.id)}
                onTranslated={(n) => setSentences((list) => list.map((x) => (x.id === n.id ? n : x)))} />}
            </Balloon>

            <div className="level" aria-hidden="true"><i ref={levelRef as never} /></div>

            <div className="controls">
              {recording ? (
                <Button onClick={discardRec} title="Stop without scoring (Esc)"><X aria-hidden="true" />Discard</Button>
              ) : (
                <Button onClick={listen} disabled={scoring || saving} aria-busy={playing}>
                  {voiceLoading ? <LoaderCircle className="loading-spinner" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}{voiceLoading ? 'Loading voice…' : playing ? 'Stop audio' : 'Listen'}
                </Button>
              )}
              <Button variant="accent" className={recording ? 'rec on' : 'rec'} onClick={recording ? stopRec : startRec} disabled={scoring || saving || (engine === 'loading' && !recording)} aria-busy={scoring || engine === 'loading'} aria-pressed={recording}>
                {recording ? <Square aria-hidden="true" /> : scoring || engine === 'loading' ? <LoaderCircle className="loading-spinner" aria-hidden="true" /> : <Mic aria-hidden="true" />}
                {scoring ? 'Scoring…' : recording ? 'Stop' : engine === 'loading' ? 'Loading Whisper…' : res ? 'Say it again' : 'Say it'}
              </Button>
              <Button variant="primary" disabled={recording || scoring || saving} onClick={() => go(1)}>Next<ChevronRight aria-hidden="true" /></Button>
              {err && (
                <Notice tone="error" className="take-error" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span className="grow">{err}</span>
                  {unsaved && <Button size="small" disabled={saving} onClick={() => save(unsaved.sentence, unsaved.result)}>Retry saving score</Button>}
                  <Button variant="ghost" size="small" icon aria-label="Dismiss" title="Dismiss (Esc)" onClick={dismissErr}><X aria-hidden="true" /></Button>
                </Notice>
              )}
            </div>
            <p className="meta take-hint">{recording ? 'Listening. It stops by itself after 1.5 seconds of silence.' : 'Recording stops by itself after 1.5 seconds of silence.'}</p>

            {i < sentences.length - 1 && (
              <Button variant="ghost" className="neighbour" disabled={recording || scoring || saving} onClick={() => go(1)} aria-label="Next sentence">
                <Balloon dim tail="none"><span className="clip">{sentences[i + 1].text}</span></Balloon>
              </Button>
            )}
          </div>
        </div>
      </>)}
    </>
  )
}

/** The keyboard, at the foot of the side column, under the source and the score. */
function Keys({ meaning }: { meaning: boolean }) {
  const keys: [string, string][] = [['L', 'listen'], ['Space', 'record / stop'], ['Esc', 'discard'], ['M', 'my take'], ['C', 'compare'], ['K', 'keep take'], ['N', 'next'], ['P', 'previous'],
    ['F', 'furigana'], ['R', 'romaji'], ...(meaning ? [['T', 'meaning'] as [string, string]] : [])]
  return (
    <dl className="keys" aria-label="Keyboard shortcuts">
      {keys.map(([k, what]) => <div key={k}><dt><Kbd>{k}</Kbd></dt><dd>{what}</dd></div>)}
    </dl>
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
        <KeptTakes s={s} stamps={s.stamps.slice(1)} />
      </div>
    </section>
  )
}

/** Before saying it: how the last tries went, from any earlier session. */
function History({ s }: { s: Sentence }) {
  const [last, ...earlier] = s.stamps
  const day = ago(last.created_at)
  return (
    <section className="result history" aria-label="Earlier scores">
      <Stamp s={last} />
      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <p className="meta">Last time, {day}{s.best != null && s.best > last.overall ? <> · best <span className="num">{s.best}</span></> : null}</p>
        <dl>
          <div><dt>Accuracy</dt><dd>{last.accuracy}</dd></div>
          <div><dt>Clarity</dt><dd>{last.clarity}</dd></div>
          <div><dt>Fluency</dt><dd>{last.fluency}</dd></div>
        </dl>
        {earlier.length > 0 && <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}><span className="meta">Before</span><Stamps stamps={earlier} max={8} /></div>}
        <KeptTakes s={s} stamps={s.stamps} />
      </div>
    </section>
  )
}

function ago(at: string) {
  const when = new Date(at)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(when).setHours(0, 0, 0, 0)) / 864e5)
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : when.toLocaleDateString()
}

/** A take's file name: which sentence, its first words, the score and the day. */
function takeName(s: Sentence, overall?: number, at = new Date().toISOString()) {
  const words = s.text.replace(/[\\/:*?"<>|\s。、.,!?！？「」]+/g, '').slice(0, 16)
  const day = new Date(at).toLocaleDateString('sv')  // YYYY-MM-DD, in local time
  return ['kotoba', s.id, words, overall, day].filter((x) => x !== undefined && x !== '').join('-') + '.wav'
}

/** Hand the browser a file to save. A blob URL is let go once the download has started. */
function saveFile(url: string, name: string, blob = false) {
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.append(a); a.click(); a.remove()
  if (blob) window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Takes kept from earlier tries, to hear how it sounded then, or to download. */
function KeptTakes({ s, stamps }: { s: Sentence; stamps: StampT[] }) {
  const [on, setOn] = useState<number | null>(null)
  const toast = useToast()
  const kept = stamps.filter((x) => x.audio).slice(0, 3)
  useEffect(() => () => { if (on != null) stopAudio() }, [on])
  if (!kept.length) return null
  const play = async (x: StampT) => {
    if (on === x.id) { stopAudio(); return }
    setOn(x.id)
    try { await playUrl(x.audio!) } catch (e) { toast({ text: (e as Error).message }) }
    finally { setOn((cur) => (cur === x.id ? null : cur)) }
  }
  return (
    <div className="take-bar" role="group" aria-label="Kept takes">
      <span className="feedback-label">Kept takes</span>
      {kept.map((x) => (
        <span key={x.id} className="kept-take">
          <Button variant="ghost" size="small" onClick={() => play(x)} aria-pressed={on === x.id} title={`Your take that scored ${x.overall}`}>
            {on === x.id ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}<span className="num">{x.overall}</span> · {ago(x.created_at)}
          </Button>
          <a className={buttonClass({ variant: 'ghost', size: 'small', icon: true })} href={x.audio!} download={takeName(s, x.overall, x.created_at)}
            aria-label={`Download your take from ${ago(x.created_at)}, scored ${x.overall}`} title="Download this take as a WAV file">
            <Download aria-hidden="true" />
          </a>
        </span>
      ))}
    </div>
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
        <Button size="small" onClick={onLoad}>Load Whisper</Button>
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
    <Panel className="big wave-panel" style={{ aspectRatio: 'auto' }}>
      <span className="kind">{s.source_kind === 'video' ? 'Video' : 'Audio'}</span>
      <div style={{ height: 8 }} />
      {!peaks && !failed && <p className="meta" role="status">Drawing the waveform…</p>}
      {failed ? <p className="meta">The waveform could not be drawn. You can still listen to the clip.</p> : <canvas ref={canvas} role="img" aria-label="Waveform of the native clip" />}
      <div className="times num"><span>{fmtTime(s.start)}</span><span>{s.end != null && s.start != null ? `${(s.end - s.start).toFixed(1)} s` : ''}</span><span>{fmtTime(s.end)}</span></div>
    </Panel>
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
      <ButtonRow>
        {weak.length > 0 && <Button variant="primary" onClick={() => again(weak)}><RotateCcw aria-hidden="true" />Practise the {weak.length} weak ones</Button>}
        <Button onClick={() => again(sentences)}>Start over</Button>
        {onFinish ? <Button variant="primary" onClick={onFinish}>Done</Button> : <ButtonLink variant="primary" to={back}>Done</ButtonLink>}
      </ButtonRow>
    </section>
  )
}
