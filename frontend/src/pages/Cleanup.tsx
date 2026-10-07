import { ChevronLeft, ChevronRight, MoreHorizontal, Maximize, Download, Pause, Play, Scissors, Settings2, FileText, BookOpen, ListPlus, Upload, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type Cleanup, type CleanupSettings, type Cut, type Job, type ScriptRow, type TChar } from '../lib/api'
import { ErrorNotice, Skeleton, usePref, useToast, useAction } from '../components/ui'

// ------------------------------------------------------------------ cut model

const TYPES = ['retake', 'retry', 'offscript', 'filler', 'repeat', 'pause', 'manual'] as const
type CutType = typeof TYPES[number]
const TYPE_NAME: Record<CutType, string> = {
  retake: 'Retake', retry: 'Earlier take', offscript: 'Off script', filler: 'Filler', repeat: 'Repeat', pause: 'Non-speech', manual: 'Yours',
}
const TYPE_HELP: Record<CutType, string> = {
  retake: 'You said the retake cue: the slip before it goes',
  retry: 'An earlier take of a script sentence; the last complete one is kept',
  offscript: 'Speech that isn\'t in the script',
  filler: 'えーと, あのー and friends',
  repeat: 'A false start you said again right after',
  pause: 'A gap without recognized speech; may contain music, ambience or silence',
  manual: 'Cuts you drew yourself',
}
type EditCut = Cut & { id: number; type: CutType }
type Mode = 'edited' | 'orig' | 'clean'

const cutType = (reason: string): CutType => {
  const t = (reason || '').split(/[:+ |]/)[0] as CutType
  return TYPES.includes(t) ? t : 'manual'
}
let nextId = 1
const withIds = (cuts: Cut[]): EditCut[] => cuts.map((c) => ({ ...c, id: nextId++, type: cutType(c.reason) }))
const plain = (cuts: EditCut[]): Cut[] => cuts.map(({ start, end, reason, on }) => ({ start, end, reason, on }))

function cutAt(cuts: EditCut[], t: number, onlyOn: boolean) {
  let best: EditCut | null = null
  for (const c of cuts) {
    if (onlyOn && !c.on) continue
    if (t >= c.start && t < c.end && (!best || c.end - c.start < best.end - best.start)) best = c
  }
  return best
}
function removedTotal(cuts: EditCut[]) {
  const iv = cuts.filter((c) => c.on).map((c) => [c.start, c.end]).sort((a, b) => a[0] - b[0])
  let tot = 0, cs = -1, ce = -1
  for (const [s, e] of iv) {
    if (s > ce) { if (ce > cs) tot += ce - cs; cs = s; ce = e } else ce = Math.max(ce, e)
  }
  return ce > cs ? tot + ce - cs : tot
}
const PUNCT = /[、。，．,.!?！？…「」『』（）()・〜~ 　"']/
const LOOSE_DROP = /[、。，．,.!?！？…「」『』（）()・〜~\s　"'ー]/g
/** zero-width characters (punctuation) belong to whatever is cut right before them */
const charCut = (cuts: EditCut[], [, s, e]: TChar) => (e > s ? cutAt(cuts, (s + e) / 2, true) : cutAt(cuts, s - 0.01, true))

// Must split exactly like jpcut.parse_script so report rows line up with sentences.
const SENT_RE = /[^\n。！？!?]+[。！？!?」』]*/g
function splitScript(text: string) {
  const out: string[] = []
  for (const line of (text || '').split(/\r?\n/))
    for (const m of line.matchAll(SENT_RE)) {
      const t = m[0].trim()
      if (t.replace(LOOSE_DROP, '')) out.push(t)
    }
  return out
}

function fmt(t: number | null | undefined, dec = 1) {
  t = Math.max(0, t || 0)
  const m = Math.floor(t / 60), s = t - m * 60
  return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`
}

// ------------------------------------------------------------------ page

export default function CleanupPage() {
  const id = Number(useParams().id)
  return <CleanupPageDetail key={id} id={id} />
}

function CleanupPageDetail({ id }: { id: number }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<unknown>(null)
  const latestCuts = useRef<EditCut[] | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const [data, setData] = useState<Cleanup | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [cuts, setCuts] = useState<EditCut[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [peaks, setPeaks] = useState<{ rate: number; peaks: number[]; duration: number } | null>(null)
  const [peaksError, setPeaksError] = useState<string | null>(null)
  const [mode, setModeState] = useState<Mode>('edited')
  const [show, setShow] = usePref<Record<CutType, boolean>>('cleanup.show.v2', { retake: true, retry: true, offscript: true, filler: true, repeat: true, pause: true, manual: true })
  const [job, setJob] = useState<Job | null>(null)
  const [tab, setTab] = useState<'transcript' | 'script' | 'cuts'>('transcript')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [followPlayback, setFollowPlayback] = usePref('cleanup.followPlayback', true)
  const followRef = useRef(followPlayback); followRef.current = followPlayback
  const [reader, setReader] = useState(false)
  const [renderStale, setRenderStale] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const pendingSave = useRef(false)
  const stopAt = useRef<{ t: number; raw?: boolean } | null>(null)
  const timeEl = useRef<HTMLSpanElement>(null)
  const wave = useRef<WaveHandle>(null)
  const transcriptRef = useRef<TranscriptHandle>(null)
  const actionMenu = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      const menu = actionMenu.current
      if (menu?.open && e.target instanceof Node && !menu.contains(e.target)) menu.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  const load = useCallback(async () => {
    try {
      const d = await api.cleanup(id)
      setError(null); setData(d); setCuts(withIds(d.cuts)); setSel(null); setRenderStale(false)
      if (d.job && (d.job.state === 'queued' || d.job.state === 'running')) setJob(d.job)
    } catch (e) { setError(e) }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    setPeaks(null); setPeaksError(null)
    api.peaks(id).then(setPeaks, (e) => setPeaksError((e as Error).message))
  }, [id])

  // ---- saving: edits are kept on the server as you make them
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const next = latestCuts.current
    if (!next || !pendingSave.current) return saveQueue.current
    setSaveState('saving'); setSaveError(null)
    const task = saveQueue.current.catch(() => {}).then(async () => {
      try {
        await api.saveCuts(id, plain(next))
        if (latestCuts.current === next) { pendingSave.current = false; setSaveState('saved') }
      } catch (err) { setSaveError(err); setSaveState('error'); throw err }
    })
    saveQueue.current = task
    return task
  }, [id])
  const persist = useCallback((next: EditCut[]) => {
    latestCuts.current = next; pendingSave.current = true; setSaveState('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void flushSave().catch(() => {}) }, 700)
  }, [flushSave])
  useEffect(() => {
    const leave = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!link || !pendingSave.current || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const url = new URL(link.getAttribute('href')!, window.location.href)
      if (url.origin !== window.location.origin || link.hasAttribute('download') || link.getAttribute('target') === '_blank' || url.pathname.startsWith('/files/') || url.pathname.startsWith('/api/')) return
      e.preventDefault(); e.stopPropagation()
      void flushSave().then(() => navigate(url.pathname + url.search + url.hash), () => {})
    }
    document.addEventListener('click', leave, true)
    return () => { document.removeEventListener('click', leave, true); window.clearTimeout(saveTimer.current); if (pendingSave.current) void flushSave().catch(() => {}) }
  }, [flushSave, navigate])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pendingSave.current) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const change = useCallback((next: EditCut[]) => {
    setCuts(next); persist(next)
    if (data?.clean) setRenderStale(true)
    setData((d) => d && { ...d, edited: true })
  }, [persist, data?.clean])

  // ---- jobs (transcription, rendering) run in the background; follow the one we started
  useEffect(() => {
    if (!job || job.state === 'done' || job.state === 'error') return
    const t = window.setTimeout(async () => {
      try {
        const j = await api.job(job.id)
        setJob(j)
        if (j.state === 'done') {
          if (j.kind === 'render') {
            const d = await api.cleanup(id)
            setData(d); setRenderStale(false)
            toast({ text: 'Clean take rendered' })
          } else { await load(); toast({ text: 'Transcribed and analysed' }) }
        }
      } catch (e) {
        setJob((cur) => cur && { ...cur, state: 'error', error: e instanceof ApiError ? e.message : String(e) })
      }
    }, 600)
    return () => window.clearTimeout(t)
  }, [job, id, load, toast])
  const busy = !!job && (job.state === 'queued' || job.state === 'running')
  const closeJob = useCallback(() => setJob(null), [])

  // ---- actions
  const analyze = async (settings: CleanupSettings, retranscribe = false) => {
    if (data?.edited && data.transcribed && !retranscribe && !window.confirm('Analysing again replaces your edits to the cuts. Continue?')) return
    try {
      await flushSave()
      const d = await api.analyze(id, settings, retranscribe)
      if (d.job && (d.job.state === 'queued' || d.job.state === 'running')) { setJob(d.job); setData(d) }
      else { setData(d); setCuts(withIds(d.cuts)); setSel(null); if (d.clean) setRenderStale(true); toast({ text: 'Cuts detected again' }) }
    } catch (e) { toast({ text: (e as Error).message }) }
  }
  const render = async () => {
    try { await flushSave(); setJob(await api.render(id, plain(cuts))) } catch (e) { toast({ text: (e as Error).message }) }
  }

  // ---- playback
  const media = data?.media
  const cleanSrc = data?.clean ? `${data.clean}?v=${encodeURIComponent(data.rendered_at ?? '')}` : null
  const setMode = (m: Mode) => {
    const a = audio.current
    if (!a || !media) { setModeState(m); return }
    const t = a.currentTime, was = !a.paused
    const want = m === 'clean' ? cleanSrc! : media
    if ((mode === 'clean') !== (m === 'clean')) {
      a.src = want
      if (m !== 'clean') a.addEventListener('loadedmetadata', () => { a.currentTime = t }, { once: true })
      if (was) a.play().catch(() => {})
    }
    setModeState(m)
  }
  const seek = (t: number) => {
    const a = audio.current
    if (!a) return
    if (mode === 'clean') setMode('edited')
    a.currentTime = Math.max(0, t); stopAt.current = null
    wave.current?.revealTime(t); transcriptRef.current?.highlight(a.currentTime, followRef.current)
  }
  const togglePlay = useCallback(() => {
    const a = audio.current
    if (!a) return
    if (a.paused) { stopAt.current = null; a.play().catch(() => {}) } else a.pause()
  }, [])
  const audition = (c: EditCut, raw: boolean) => {
    const a = audio.current
    if (!a) return
    if (mode === 'clean') setMode('edited')
    // raw: hear only what gets removed; otherwise the result around the cut
    if (raw) { a.currentTime = c.start; stopAt.current = { t: c.end, raw: true } }
    else { a.currentTime = Math.max(0, c.start - 2); stopAt.current = { t: c.end + 2 } }
    a.play().catch(() => {})
  }

  // the playback loop: skip enabled cuts in "Skip cuts" mode, follow the playhead
  const cutsRef = useRef(cuts); cutsRef.current = cuts
  const modeRef = useRef(mode); modeRef.current = mode
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = audio.current
      if (!a || a.paused) return
      const t = a.currentTime
      if (modeRef.current === 'edited' && !stopAt.current?.raw) {
        const c = cutAt(cutsRef.current, t, true)
        if (c && c.end - t > 0.02) {
          let end = c.end, n: EditCut | null
          while ((n = cutAt(cutsRef.current, end + 0.001, true)) && n.end > end) end = n.end
          a.currentTime = end
        }
      }
      if (stopAt.current && t >= stopAt.current.t) { a.pause(); stopAt.current = null }
      if (followRef.current) wave.current?.follow(a.currentTime)
      else wave.current?.draw()
      transcriptRef.current?.highlight(a.currentTime, followRef.current)
      if (timeEl.current) timeEl.current.textContent = fmt(a.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // ---- keys
  const selected = cuts.find((c) => c.id === sel) ?? null
  const keyState = useRef({ selected, cuts, show, change, audition, togglePlay })
  keyState.current = { selected, cuts, show, change, audition, togglePlay }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reader) { if (e.key === 'Escape') setReader(false); return }
      const el = e.target as HTMLElement
      if (e.isComposing || e.repeat || e.defaultPrevented || el.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"])')) return
      if (el.closest?.('button,a') && (e.key === ' ' || e.key === 'Enter')) return   // let the focused control act
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const { selected: c, cuts: list, show: sh, change: ch } = keyState.current
      if (e.key === ' ') { e.preventDefault(); keyState.current.togglePlay() }
      else if (e.key === 'x' && c) ch(list.map((x) => (x === c ? { ...x, on: !x.on } : x)))
      else if ((e.key === 'Delete' || e.key === 'Backspace') && c) { e.preventDefault(); ch(list.filter((x) => x !== c)); setSel(null) }
      else if (e.key === 'a' && c) keyState.current.audition(c, false)
      else if (e.key === 'j' || e.key === 'k') {
        const vis = [...list].sort((a, b) => a.start - b.start).filter((x) => sh[x.type])
        if (!vis.length) return
        let i = c ? vis.indexOf(c) : -1
        if (i < 0) {
          const t = audio.current?.currentTime ?? 0
          i = e.key === 'k' ? vis.findIndex((x) => x.start > t) : vis.findLastIndex((x) => x.start < t)
          if (i < 0) i = e.key === 'k' ? 0 : vis.length - 1
        } else i = Math.max(0, Math.min(vis.length - 1, i + (e.key === 'k' ? 1 : -1)))
        setSel(vis[i].id); wave.current?.reveal(vis[i])
        if (audio.current) audio.current.currentTime = Math.max(0, vis[i].start - 0.5)
      } else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reader])

  if (error) return <ErrorNotice error={error} action={<Link className="btn small" to="/recordings">Back to recordings</Link>} />
  if (!data) return <Skeleton rows={4} />

  const duration = data.duration || peaks?.duration || 0
  const removed = removedTotal(cuts)
  const scriptSentences = splitScript(data.script)

  const visibleCuts = [...cuts].sort((a, b) => a.start - b.start).filter(c => show[c.type] || c.id === sel)
  const pickCut = (c: EditCut) => {
    setSel(c.id); seek(Math.max(0, c.start - .5)); wave.current?.reveal(c)
  }
  const stepCut = (direction: number) => {
    if (!visibleCuts.length) return
    const index = visibleCuts.findIndex(c => c.id === sel)
    const next = index < 0 ? (direction > 0 ? 0 : visibleCuts.length - 1) : Math.max(0, Math.min(visibleCuts.length - 1, index + direction))
    pickCut(visibleCuts[next])
  }
  return (
    <div className="recording-editor">
      <header className="recording-head">
        <Link className="btn icon ghost" to="/recordings" aria-label="Back to recordings"><ChevronLeft aria-hidden="true" /></Link>
        <div className="recording-heading">
          <h1>{data.title}</h1>
          <div className="recording-summary meta">
            <span className="num">{fmt(duration, 0)} original · {fmt(Math.max(0, duration - removed), 0)} after cuts</span>
            <span>{cuts.filter(c => c.on).length} cuts applied</span>
            <span className="recording-save" role="status">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : saveState === 'saved' ? 'Saved' : 'Edits save automatically'}</span>
          </div>
        </div>
        <details ref={actionMenu} className="recording-actions" onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus() }
        }}>
          <summary className="btn ghost" aria-label="Recording actions"><MoreHorizontal aria-hidden="true" /><span>Actions</span></summary>
          <div className="recording-action-menu">
            <button className="btn ghost" onClick={e => { setSettingsOpen(o => !o); e.currentTarget.closest('details')?.removeAttribute('open') }}><Settings2 aria-hidden="true" />Analysis settings</button>
            <button className="btn ghost" disabled={busy || !data.can_transcribe && !data.transcribed} onClick={e => { void analyze(data.settings); e.currentTarget.closest('details')?.removeAttribute('open') }}><Scissors aria-hidden="true" />{data.transcribed ? 'Analyse again' : 'Transcribe & analyse'}</button>
            <Link className="btn ghost" to={`/sources/${data.source}`}>View sentences</Link>
            <MakeSentences data={data} cuts={cuts} fromScript={tab === 'script'} onDone={load} />
            {data.clean && <a className="btn ghost" href={data.clean + '?dl=1'} title={renderStale ? 'This download is from before your latest edits' : 'Download the clean take'}><Download aria-hidden="true" />Download clean take{renderStale && ' (outdated)'}</a>}
          </div>
        </details>
        <button className="btn primary recording-render" disabled={busy || !data.transcribed && cuts.length === 0} onClick={render} title="Render the recording without the enabled cuts">{busy ? 'Working…' : data.clean && !renderStale ? 'Render again' : 'Render clean take'}</button>
      </header>
      {saveError != null && <div className="recording-alerts"><ErrorNotice error={saveError} action={<button className="btn small" onClick={() => { void flushSave().catch(() => {}) }}>Retry saving cuts</button>} /></div>}
      <div className="recording-workspace">
        {settingsOpen && <section className="panel recording-settings" aria-label="Analysis settings workspace">
          <div className="panel-head"><h2>Analysis settings</h2><span className="grow" /><button className="btn small ghost" onClick={() => setSettingsOpen(false)}><X aria-hidden="true" />Back to editing</button></div>
          <div className="recording-settings-scroll"><SettingsSheet data={data} busy={busy} onAnalyze={(s, re) => { void analyze(s, re); setSettingsOpen(false) }} /></div>
        </section>}
        <div className="recording-edit-area" hidden={settingsOpen}>
          <div className="recording-pane-bar">
            <div className="tabs" role="group" aria-label="Editing view">
              <button aria-pressed={tab === 'transcript'} onClick={() => setTab('transcript')}>Transcript</button>
              <button aria-pressed={tab === 'script'} onClick={() => setTab('script')}>Script{scriptSentences.length > 0 && <span className="n num">{scriptSentences.length}</span>}</button>
              <button className="recording-cuts-tab" aria-pressed={tab === 'cuts'} onClick={() => setTab('cuts')}>Cuts <span className="n num">{cuts.length}</span></button>
            </div>
            <label className="recording-follow meta"><input className="check" type="checkbox" aria-label="Follow playback" checked={followPlayback} onChange={e => setFollowPlayback(e.target.checked)} /><span>Follow<span className="recording-follow-extra"> playback</span></span></label>
          </div>
          <div className={'cut-cols recording-panes' + (tab === 'cuts' ? ' showing-cuts' : '')}>
            <section className="panel cut-text" aria-label={tab === 'script' ? 'Script' : 'Transcript'}>
              <div className="panel-head recording-transcript-head"><h2>{tab === 'script' ? 'Script' : 'Transcript'}</h2><span className="meta">{tab === 'script' ? 'Click a sentence to seek' : 'Click text to seek · struck-through text is cut'}</span></div>
          {!data.transcribed && !busy && <div className="notice recording-transcribe-notice"><FileText aria-hidden="true" />
            {data.can_transcribe ? <span>Use <b>Transcribe &amp; analyse</b> in the actions menu to detect speech and suggested cuts. Add your script first for better matching.</span> : <span>Whisper and ffmpeg are needed for transcription. <Link to="/addons">See Add-ons</Link>. You can still draw and render cuts.</span>}
          </div>}
          {tab !== 'script'
            ? <Transcript ref={transcriptRef} utts={data.utts} cuts={cuts} busy={busy} onPick={(t, c) => { seek(c ? Math.max(0, c.start - 0.5) : t); if (c) { setSel(c.id); wave.current?.reveal(c) } }} />
            : <ScriptPane data={data} cuts={cuts} audioTime={() => audio.current?.currentTime ?? 0} playing={playing}
                onSaved={(script) => { setData({ ...data, script, report: null }); }} onSeek={(t) => { seek(t); wave.current?.revealTime(t) }}
                onRead={() => setReader(true)} onAnalyze={() => analyze(data.settings)} />}
            </section>
            <section className="panel cut-list-panel" aria-label="Cuts">
              <div className="panel-head">
                <h2>Cuts <span className="meta num">{cuts.filter(c => c.on).length}/{cuts.length} applied</span></h2><span className="grow" />
                <button className="btn small ghost" title="Apply every cut of the types shown" onClick={() => change(cuts.map(c => show[c.type] ? { ...c, on: true } : c))}>Cut shown</button>
                <button className="btn small ghost" title="Keep all audio in cuts of the types shown" onClick={() => change(cuts.map(c => show[c.type] ? { ...c, on: false } : c))}>Keep shown</button>
              </div>
              <details className="recording-filters"><summary>Filter cut types <span className="meta">{TYPES.filter(t => show[t]).length}/{TYPES.length} shown</span></summary><div className="recording-filter-body">
        <div className="legend" role="group" aria-label="Cut types shown">
          {TYPES.map((t) => {
            const all = cuts.filter((c) => c.type === t), on = all.filter((c) => c.on).length
            return (
              <label key={t} title={TYPE_HELP[t]}>
                <input type="checkbox" className="check" checked={show[t]} onChange={(e) => setShow({ ...show, [t]: e.target.checked })} />
                <i className={'swatch cut-' + t} aria-hidden="true" />{TYPE_NAME[t]}
                <span className="meta num">{on}{on !== all.length ? `/${all.length}` : ''}</span>
              </label>
            )
          })}
        </div>      {cuts.some(c => c.type === 'pause') && <div className="notice">
        <div><p>Non-speech cuts may contain music or ambience. Filters change visibility only; hidden cuts still apply.</p>
          <button className="btn small" disabled={!cuts.some(c => c.type === 'pause' && c.on)} onClick={() => {
            change(cuts.map(c => c.type === 'pause' ? { ...c, on: false } : c))
            setShow({ ...show, pause: true })
            toast({ text: 'Non-speech cuts turned off. Music and ambience in those sections will be kept.' })
          }}>Keep all non-speech audio</button>
          <p className="meta">To keep it after reanalysis, turn off “Automatically trim gaps without speech” in Settings. Render again to update a previously cleaned recording.</p>
        </div>
      </div>}
              </div></details>
              <CutList cuts={cuts} sel={sel} show={show} onSelect={pickCut} onChange={change} onAudition={audition} onDelete={c => { change(cuts.filter(x => x !== c)); setSel(null) }} />
            </section>
          </div>
        </div>
      </div>
      <section className="panel cut-wave" aria-label="Waveform">
        <div className="wave-bar">
          <button className="btn icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (space)">
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <span className="time num"><span ref={timeEl}>0:00.0</span> / {fmt(mode === 'clean' ? audio.current?.duration : duration)}</span>
          <div className="seg" role="radiogroup" aria-label="Playback">
            {([['edited', 'Skip cuts'], ['orig', 'Original'], ['clean', 'Rendered']] as [Mode, string][]).map(([m, label]) => (
              <label key={m} title={m === 'clean' && !data.clean ? 'Render first' : undefined}>
                <input type="radio" name="mode" checked={mode === m} disabled={m === 'clean' && !data.clean} onChange={() => setMode(m)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <span className="grow" />
          <button className="btn small ghost recording-fit" aria-label="Fit recording" onClick={() => wave.current?.fit()} title="Show the full recording"><Maximize aria-hidden="true" /><span>Fit recording</span></button>
          <ZoomControl onZoom={(z) => wave.current?.zoom(z)} />
        </div>
        <div className="recording-selection" aria-label="Selected cut">
          <div className="btn-row">
            <button className="btn small icon ghost" disabled={!visibleCuts.length} onClick={() => stepCut(-1)} aria-label="Previous cut" title="Previous cut (J)"><ChevronLeft aria-hidden="true" /></button>
            <button className="btn small icon ghost" disabled={!visibleCuts.length} onClick={() => stepCut(1)} aria-label="Next cut" title="Next cut (K)"><ChevronRight aria-hidden="true" /></button>
          </div>
          {selected ? <>
            <span className="meta recording-selection-label"><b>{TYPE_NAME[selected.type]}</b> <span className="num">{fmt(selected.start, 2)} – {fmt(selected.end, 2)}</span></span>
            <button className="btn small" aria-label="Preview result" title="Preview result (A)" onClick={() => audition(selected, false)}><Play aria-hidden="true" /><span className="recording-selection-action">Preview result</span></button>
            <button className="btn small ghost" aria-label={selected.on ? 'Keep this audio' : 'Cut this audio'} title={selected.on ? 'Keep this audio (X)' : 'Cut this audio (X)'} onClick={() => change(cuts.map(c => c.id === selected.id ? { ...c, on: !c.on } : c))}>{selected.on ? <RotateCcw aria-hidden="true" /> : <Scissors aria-hidden="true" />}<span className="recording-selection-action">{selected.on ? 'Keep this audio' : 'Cut this audio'}</span></button>
          </> : <span className="meta recording-selection-label">Select a cut to adjust or preview it. Drag the waveform to make a cut.</span>}
        </div>
        <Wave ref={wave} peaks={peaks} peaksError={peaksError} duration={duration} cuts={cuts} sel={sel} show={show} mode={mode} audio={audio}
          onSeek={seek} onSelect={setSel} onChange={change} />
        <details className="wave-shortcuts"><summary>Editing shortcuts</summary><div className="hints wave-help">
          <span>Click: seek or pick a cut</span><span>Drag an edge: adjust</span><span>Drag empty space: new cut</span><span>Double-click a cut: on/off</span>
          <span><kbd className="kbd">space</kbd> play</span><span><kbd className="kbd">x</kbd> on/off</span><span><kbd className="kbd">del</kbd> delete</span>
          <span><kbd className="kbd">j</kbd><kbd className="kbd">k</kbd> previous / next cut</span><span><kbd className="kbd">a</kbd> hear the result</span><span><kbd className="kbd">ctrl</kbd>+wheel zoom</span>
        </div></details>
        <audio ref={audio} src={media} preload="auto" hidden
          onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); wave.current?.draw() }} onEnded={() => setPlaying(false)}
          onSeeked={() => { if (timeEl.current && audio.current) timeEl.current.textContent = fmt(audio.current.currentTime) }} />
      </section>

      {job && <JobBar job={job} onClose={closeJob} />}
      {reader && <Reader title={data.title} sentences={scriptSentences} onClose={() => setReader(false)} />}
    </div>
  )
}

function ZoomControl({ onZoom }: { onZoom: (z: number) => void }) {
  const [z, setZ] = usePref('cleanup.zoom', 35)
  const cb = useRef(onZoom); cb.current = onZoom
  useEffect(() => { cb.current(z) }, [z])
  return (
    <label className="zoom meta">Zoom
      <input type="range" min={0} max={100} value={z} onChange={(e) => setZ(+e.target.value)} />
    </label>
  )
}

// ------------------------------------------------------------------ waveform

type WaveHandle = { draw: () => void; follow: (t: number) => void; reveal: (c: Cut) => void; revealTime: (t: number) => void; zoom: (z: number) => void; fit: () => void }
type WaveProps = {
  peaks: { rate: number; peaks: number[] } | null; peaksError: string | null; duration: number
  cuts: EditCut[]; sel: number | null; show: Record<CutType, boolean>; mode: Mode
  audio: React.RefObject<HTMLAudioElement | null>
  onSeek: (t: number) => void; onSelect: (id: number | null) => void; onChange: (cuts: EditCut[]) => void
  ref: React.Ref<WaveHandle>
}
const WAVE_H = 144, RULER = 20
const zoomToPps = (v: number) => 8 * Math.pow(400 / 8, v / 100) // 8..400 px per second

/** Screentone and hatching per cut type, drawn in ink like the CSS swatches. */
function patternFor(ctx: CanvasRenderingContext2D, type: CutType, ink: string, ink3: string, red: string): string | CanvasPattern {
  if (type === 'retake') return ink
  const size = type === 'pause' ? 6 : 6
  const off = document.createElement('canvas'); off.width = off.height = size
  const g = off.getContext('2d')!
  g.strokeStyle = g.fillStyle = type === 'manual' ? red : type === 'pause' ? ink3 : ink
  g.lineWidth = 1.2
  const line = (x0: number, y0: number, x1: number, y1: number) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke() }
  const dot = (x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
  if (type === 'retry' || type === 'offscript') { line(0, size, size, 0); line(-1, 1, 1, -1); line(size - 1, size + 1, size + 1, size - 1) }
  if (type === 'offscript' || type === 'manual') { line(0, 0, size, size); line(-1, size - 1, 1, size + 1); line(size - 1, -1, size + 1, 1) }
  if (type === 'filler') { dot(1.5, 1.5, 1.1); dot(4.5, 4.5, 1.1) }
  if (type === 'repeat') { line(0, 1.5, size, 1.5); line(0, 4.5, size, 4.5) }
  if (type === 'pause') dot(3, 3, 0.9)
  return ctx.createPattern(off, 'repeat')!
}

function Wave({ peaks, peaksError, duration, cuts, sel, show, mode, audio, onSeek, onSelect, onChange, ref }: WaveProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const pps = useRef(60)
  const zoomV = useRef(35)
  const live = useRef(cuts)                 // the cuts as drawn, including a drag in progress
  const drag = useRef<null | { kind: 'edge'; c: EditCut; side: 'start' | 'end'; moved: boolean } | { kind: 'new'; x0: number; t0: number; cut?: EditCut; hit: EditCut | null }>(null)
  const props = useRef({ peaks, duration, sel, show, mode })
  props.current = { peaks, duration, sel, show, mode }
  useEffect(() => { if (!drag.current) live.current = cuts }, [cuts])

  const xToT = (x: number) => ((wrap.current?.scrollLeft ?? 0) + x) / pps.current
  const tToX = (t: number) => t * pps.current - (wrap.current?.scrollLeft ?? 0)

  const draw = useCallback(() => {
    const cv = canvas.current, w = wrap.current?.clientWidth ?? 0
    if (!cv || !w) return
    const ctx = cv.getContext('2d')!
    const css = getComputedStyle(cv)
    const v = (n: string) => css.getPropertyValue(n).trim()
    const ink = v('--ink'), ink2 = v('--ink-2'), ink3 = v('--ink-3'), red = v('--red'), paper = v('--paper')
    const { peaks: pk, show: sh, sel: sl, mode: md } = props.current
    const h = cv.clientHeight || WAVE_H
    ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h)
    const mid = RULER + (h - RULER) / 2, amp = (h - RULER) / 2 - 8
    const t0 = xToT(0), t1 = xToT(w)
    const list = live.current

    // cut regions: screentone per type
    for (const c of list) {
      if (c.end < t0 || c.start > t1 || (!sh[c.type] && c.id !== sl)) continue
      const x0 = tToX(c.start), x1 = tToX(c.end), wd = Math.max(1, x1 - x0)
      ctx.globalAlpha = c.on ? (c.type === 'retake' ? 0.2 : 0.55) : 0.16
      ctx.fillStyle = patternFor(ctx, c.type, ink, ink3, red)
      ctx.fillRect(x0, RULER, wd, h - RULER)
      ctx.globalAlpha = c.on ? 1 : 0.5
      ctx.strokeStyle = c.type === 'manual' ? red : ink; ctx.lineWidth = 1
      ctx.setLineDash(c.on ? [] : [4, 3])
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, RULER); ctx.lineTo(x0 + 0.5, h); ctx.moveTo(x1 - 0.5, RULER); ctx.lineTo(x1 - 0.5, h); ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // the waveform: kept sound in ink, cut sound pushed back
    if (pk) {
      const rate = pk.rate
      for (let x = 0; x < w; x++) {
        const a = Math.floor(xToT(x) * rate), b = Math.max(a + 1, Math.floor(xToT(x + 1) * rate))
        if (a >= pk.peaks.length) break
        let p = 0
        for (let i = a; i < b && i < pk.peaks.length; i++) if (pk.peaks[i] > p) p = pk.peaks[i]
        const hh = Math.max(0.5, p * amp)
        const cut = cutAt(list, xToT(x + 0.5), true)
        ctx.globalAlpha = cut ? 0.35 : 1
        ctx.fillStyle = cut ? ink3 : ink2
        ctx.fillRect(x, mid - hh, 1, hh * 2)
      }
      ctx.globalAlpha = 1
    }

    // the selected cut: a bold panel frame with grips
    const s = list.find((c) => c.id === sl)
    if (s && s.end >= t0 && s.start <= t1) {
      const x0 = tToX(s.start), x1 = tToX(s.end)
      ctx.strokeStyle = ink; ctx.lineWidth = 3
      ctx.strokeRect(x0 + 1.5, RULER + 1.5, Math.max(3, x1 - x0 - 3), h - RULER - 3)
      ctx.fillStyle = ink
      ctx.fillRect(x0, RULER + (h - RULER) / 2 - 12, 6, 24); ctx.fillRect(x1 - 6, RULER + (h - RULER) / 2 - 12, 6, 24)
    }

    // ruler
    ctx.fillStyle = paper; ctx.fillRect(0, 0, w, RULER)
    ctx.fillStyle = ink3; ctx.strokeStyle = ink; ctx.lineWidth = 1
    ctx.font = `400 11px ${v('--mono')}`
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((st) => st * pps.current >= 72) || 600
    ctx.beginPath(); ctx.moveTo(0, RULER - 0.5); ctx.lineTo(w, RULER - 0.5); ctx.stroke()
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = Math.round(tToX(t)) + 0.5
      ctx.beginPath(); ctx.moveTo(x, RULER - 6); ctx.lineTo(x, RULER); ctx.stroke()
      ctx.fillText(fmt(t, step < 1 ? 1 : 0), x + 4, 13)
    }

    // playhead
    const px = tToX(audio.current?.currentTime ?? 0)
    if (md !== 'clean' && px >= 0 && px <= w) {
      ctx.fillStyle = ink; ctx.fillRect(Math.round(px) - 1, RULER, 2, h - RULER)
      ctx.beginPath(); ctx.moveTo(px - 6, RULER - 7); ctx.lineTo(px + 6, RULER - 7); ctx.lineTo(px, RULER + 1); ctx.closePath(); ctx.fill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio])

  const layout = useCallback(() => {
    const cv = canvas.current, wr = wrap.current
    if (!cv || !wr) return
    const w = wr.clientWidth, dpr = window.devicePixelRatio || 1
    const dur = props.current.duration
    pps.current = zoomV.current < 0 ? w / Math.max(1, dur) : Math.max(dur ? w / dur : 8, zoomToPps(zoomV.current))
    const height = parseFloat(getComputedStyle(wr).getPropertyValue('--wave-height')) || WAVE_H
    cv.width = w * dpr; cv.height = height * dpr
    cv.style.width = w + 'px'; cv.style.height = height + 'px'
    cv.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (spacer.current) spacer.current.style.width = Math.max(w, (dur || 0) * pps.current) + 'px'
    draw()
  }, [draw])

  const zoomAround = useCallback((x: number, z: number) => {
    const wr = wrap.current
    if (!wr) return
    const t = xToT(x)
    zoomV.current = Math.max(0, Math.min(100, z)); layout()
    wr.scrollLeft = t * pps.current - x; draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, draw])

  useEffect(() => { layout() }, [layout, duration, peaks])
  useEffect(() => { draw() }, [draw, cuts, sel, show, mode])
  useEffect(() => {
    const wr = wrap.current
    if (!wr) return
    const ro = new ResizeObserver(layout); ro.observe(wr)
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomAround(e.clientX - wr.getBoundingClientRect().left, zoomV.current - Math.sign(e.deltaY) * 6)
    }
    wr.addEventListener('wheel', onWheel, { passive: false })
    return () => { ro.disconnect(); wr.removeEventListener('wheel', onWheel) }
  }, [layout, zoomAround])

  const reveal = (c: Cut) => {
    const wr = wrap.current
    if (!wr) return
    const w = wr.clientWidth, x0 = tToX(c.start), x1 = tToX(c.end)
    if (x0 < 0 || x1 > w) wr.scrollLeft = c.start * pps.current - w * 0.3
    draw()
  }
  const revealTime = (t: number) => { const wr = wrap.current; if (wr) { wr.scrollLeft = t * pps.current - wr.clientWidth * 0.2; draw() } }
  const follow = (t: number) => {
    const wr = wrap.current
    if (!wr) return
    const w = wr.clientWidth, x = tToX(t)
    if (props.current.mode !== 'clean' && !drag.current && (x < 0 || x > w - 40)) wr.scrollLeft = t * pps.current - w * 0.15
    draw()
  }
  // the handle the page uses to steer the waveform
  useImperativeHandle(ref, () => ({ draw, follow, reveal, revealTime, zoom: (z) => zoomAround((wrap.current?.clientWidth ?? 0) / 2, z), fit: () => { zoomV.current = -1; layout(); if (wrap.current) wrap.current.scrollLeft = 0; draw() } }))

  const visible = (c: EditCut) => props.current.show[c.type] || c.id === props.current.sel
  const edgeAt = (x: number) => {
    let best: { c: EditCut; side: 'start' | 'end' } | null = null, bd = 7
    for (const c of live.current) {
      if (!visible(c)) continue
      for (const side of ['start', 'end'] as const) {
        const d = Math.abs(tToX(c[side]) - x)
        if (d < bd) { bd = d; best = { c, side } }
      }
    }
    return best
  }
  const visibleCutAt = (t: number) => { const c = cutAt(live.current, t, false); return c && visible(c) ? c : null }

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const x = e.nativeEvent.offsetX, t = xToT(x)
    e.currentTarget.setPointerCapture(e.pointerId)
    const edge = edgeAt(x)
    if (edge) {
      // edit a copy while dragging; React state gets the result on release
      const copy = { ...edge.c }
      live.current = live.current.map((c) => (c === edge.c ? copy : c))
      drag.current = { kind: 'edge', c: copy, side: edge.side, moved: false }
      onSelect(copy.id); return
    }
    drag.current = { kind: 'new', x0: x, t0: t, hit: visibleCutAt(t) }
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX, t = Math.max(0, Math.min(props.current.duration || 1e9, xToT(x)))
    const d = drag.current
    if (!d) { e.currentTarget.style.cursor = edgeAt(x) ? 'ew-resize' : visibleCutAt(t) ? 'pointer' : 'crosshair'; return }
    if (d.kind === 'edge') {
      d.moved = true
      if (d.side === 'start') d.c.start = Math.min(t, d.c.end - 0.02); else d.c.end = Math.max(t, d.c.start + 0.02)
      draw(); return
    }
    if (Math.abs(x - d.x0) > 4) {
      if (!d.cut) {
        d.cut = { start: d.t0, end: d.t0, reason: 'manual', type: 'manual', on: true, id: nextId++ }
        live.current = [...live.current, d.cut]
        props.current.sel = d.cut.id
      }
      d.cut.start = Math.min(d.t0, t); d.cut.end = Math.max(d.t0, t)
      draw()
    }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'edge') { if (d.moved) onChange(live.current.map((c) => ({ ...c, start: +c.start.toFixed(3), end: +c.end.toFixed(3) }))); else live.current = cuts; return }
    if (d.cut) { onChange(live.current); onSelect(d.cut.id); return }
    onSeek(d.t0)
    onSelect(d.hit?.id ?? null)
  }
  const dbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = visibleCutAt(xToT(e.nativeEvent.offsetX))
    if (c) onChange(cuts.map((x) => (x.id === c.id ? { ...x, on: !x.on } : x)))
  }

  return (
    <div className="wave-wrap" ref={wrap} onScroll={draw}>
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl}
        role="img" aria-label="Waveform with the cuts marked; use the cut list to edit them with the keyboard" />
      <div ref={spacer} className="wave-spacer" />
      {!peaks && <div className="wave-msg meta">{peaksError ?? 'Drawing the waveform…'}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ transcript

type TranscriptHandle = { highlight: (t: number, follow?: boolean) => void }
function Transcript({ utts, cuts, busy, onPick, ref }: {
  utts: TChar[][]; cuts: EditCut[]; busy: boolean; onPick: (t: number, c: EditCut | null) => void; ref: React.Ref<TranscriptHandle>
}) {
  const box = useRef<HTMLDivElement>(null)
  const flat = useMemo(() => utts.flat(), [utts])
  const now = useRef<HTMLElement | null>(null)
  useImperativeHandle(ref, () => ({
    highlight: (t: number, follow = true) => {
      const root = box.current
      if (!root || !flat.length) return
      let lo = 0, hi = flat.length - 1
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (flat[m][1] <= t) lo = m; else hi = m - 1 }
      const ch = flat[lo]
      const el = ch && t >= ch[1] && t < ch[2] + 0.05 ? root.querySelector<HTMLElement>(`[data-i="${lo}"]`) : null
      if (el === now.current) return
      now.current?.classList.remove('now')
      now.current = el
      if (el) {
        el.classList.add('now')
        const r = el.getBoundingClientRect(), br = root.getBoundingClientRect()
        if (follow && (r.top < br.top || r.bottom > br.bottom)) root.scrollTop += r.top - br.top - root.clientHeight / 3
      }
    },
  }), [flat])
  if (!utts.length) return <div className="cut-scroll"><p className="meta" style={{ padding: 'var(--s-4)' }}>{busy ? 'Transcribing…' : 'Nothing transcribed yet.'}</p></div>
  let i = 0
  return (
    <div className="cut-scroll transcript" ref={box} lang="ja">
      {utts.map((u, k) => {
        const first = u.find((c) => !PUNCT.test(c[0])) ?? u[0]
        return (
          <div className="utt" key={k}>
            <button className="tc num" onClick={() => onPick(first[1], null)}>{fmt(first[1], 0)}</button>
            <p>
              {u.map((ch) => {
                const n = i++
                const c = charCut(cuts, ch)
                const cls = c ? 'x cut-' + (ch[3] ? cutType(ch[3]) : c.type) : ch[3] ? 'restored' : undefined
                return <span key={n} data-i={n} className={cls} title={c ? c.reason : ch[3] ? `${ch[3]} (cut turned off)` : undefined}
                  onClick={() => onPick(ch[1], cutAt(cuts, (ch[1] + ch[2]) / 2, false))}>{ch[0]}</span>
              })}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ cut list

function CutList({ cuts, sel, show, onSelect, onChange, onAudition, onDelete }: {
  cuts: EditCut[]; sel: number | null; show: Record<CutType, boolean>
  onSelect: (c: EditCut) => void; onChange: (c: EditCut[]) => void; onAudition: (c: EditCut, raw: boolean) => void; onDelete: (c: EditCut) => void
}) {
  const box = useRef<HTMLUListElement>(null)
  const list = [...cuts].sort((a, b) => a.start - b.start).filter((c) => show[c.type] || c.id === sel)
  useEffect(() => {
    const root = box.current, row = root?.querySelector('.sel')
    if (!root || !row) return
    const r = row.getBoundingClientRect(), br = root.getBoundingClientRect()
    if (r.top < br.top) root.scrollTop += r.top - br.top
    else if (r.bottom > br.bottom) root.scrollTop += r.bottom - br.bottom
  }, [sel])
  if (!list.length) return <p className="meta" style={{ padding: 'var(--s-4)' }}>{cuts.length ? 'No cuts of the types shown.' : 'No cuts yet. Drag across the waveform to make one.'}</p>
  const set = (c: EditCut, patch: Partial<EditCut>) => onChange(cuts.map((x) => (x === c ? { ...x, ...patch } : x)))
  return (
    <ul className="cut-scroll cut-list" ref={box}>
      {list.map((c) => {
        const text = c.reason.includes(':') ? c.reason.slice(c.reason.indexOf(':') + 1).trim() : c.type === 'pause' ? 'no recognized speech' : ''
        return (
          <li key={c.id} className={(c.on ? '' : 'off ') + (c.id === sel ? 'sel' : '')} onClick={(e) => { if (!(e.target as HTMLElement).closest('input,button')) onSelect(c) }}>
            <input type="checkbox" className="check" checked={c.on} onChange={(e) => set(c, { on: e.target.checked })} aria-label={`Apply the ${TYPE_NAME[c.type].toLowerCase()} cut at ${fmt(c.start)}`} />
            <div className="cut-body">
              <div className="cut-head">
                <i className={'swatch cut-' + c.type} aria-hidden="true" /><b>{TYPE_NAME[c.type]}</b>
                <button className="cut-time meta num" onClick={() => onSelect(c)} aria-label={`Select ${TYPE_NAME[c.type].toLowerCase()} cut at ${fmt(c.start)}`}>{fmt(c.start, 2)} – {fmt(c.end, 2)} · {(c.end - c.start).toFixed(2)}s</button>
              </div>
              {text && <div className="cut-said" lang="ja">{text}</div>}
              {c.id === sel && (
                <div className="cut-edit">
                  <label className="meta">start <input className="input num" type="number" step="0.01" min="0" defaultValue={c.start.toFixed(3)} key={'s' + c.start}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v < c.end) set(c, { start: v }) }} /></label>
                  <label className="meta">end <input className="input num" type="number" step="0.01" min="0" defaultValue={c.end.toFixed(3)} key={'e' + c.end}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v) && v > c.start) set(c, { end: v }) }} /></label>
                  <button className="btn small ghost" onClick={() => onDelete(c)}><X aria-hidden="true" />Delete</button>
                </div>
              )}
            </div>
            <div className="cut-acts">
              <button className="btn small" onClick={() => { onSelect(c); onAudition(c, false) }} title="Hear the result around this cut (a)"><Play aria-hidden="true" />Result</button>
              <button className="btn small ghost" onClick={() => { onSelect(c); onAudition(c, true) }} title="Hear only what gets cut"><Scissors aria-hidden="true" />Cut</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ------------------------------------------------------------------ script

type Status = ScriptRow['status'] | 'cut'
/** The analysis status, downgraded when the kept take has since been cut by hand. */
function scriptStatuses(report: ScriptRow[], cuts: EditCut[]): Status[] {
  return report.map((r) => (r.status === 'missing' || r.start == null ? r.status : cutAt(cuts, (r.start + (r.end ?? r.start)) / 2, true) ? 'cut' : r.status))
}
const MARK: Record<Status, string> = { ok: '○', partial: '△', missing: '✕', cut: '✂' }
const STATUS_TEXT: Record<Status, string> = { ok: 'read', partial: 'only partly read', missing: 'not found in the recording', cut: 'the kept take is cut by your edits' }

function ScriptPane({ data, cuts, audioTime, playing, onSaved, onSeek, onRead, onAnalyze }: {
  data: Cleanup; cuts: EditCut[]; audioTime: () => number; playing: boolean
  onSaved: (script: string) => void; onSeek: (t: number) => void; onRead: () => void; onAnalyze: () => void
}) {
  const toast = useToast()
  const action = useAction()
  const sentences = splitScript(data.script)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.script)
  const [stale, setStale] = useState(false)
  const [now, setNow] = useState(-1)
  const file = useRef<HTMLInputElement>(null)
  const report = data.report
  const aligned = report && report.length === sentences.length
  useEffect(() => {
    if (!playing || !report) return
    const t = window.setInterval(() => {
      const at = audioTime()
      setNow(report.findIndex((r) => r.start != null && at >= r.start && at <= (r.end ?? r.start)))
    }, 200)
    return () => window.clearInterval(t)
  }, [playing, report, audioTime])

  const save = async (text: string) => action.run(async () => {
      const r = await api.saveScript(data.source, text)
      onSaved(r.script); setEditing(false); setStale(data.transcribed)
      toast({ text: r.script ? `Script saved: ${r.sentences} sentences` : 'Script removed' })
  })
  const importFile = async (f: File) => {
    const buf = await f.arrayBuffer()
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { text = new TextDecoder('shift_jis').decode(buf) } // common for Japanese .txt files
    text = text.replace(/^﻿/, '')
    if (data.script.trim() && !window.confirm(`Replace the current script with ${f.name}?`)) return
    setDraft(text); save(text)
  }
  const picker = <input ref={file} type="file" accept=".txt,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />

  if (!sentences.length || editing) {
    const n = splitScript(draft).length
    return (
      <div className="cut-scroll script-edit">
        {!sentences.length && <p className="meta">Paste or import the text you read for this recording. Analysing then cuts anything that isn't in it and keeps only the last complete take of each sentence. One sentence per line, or separated by 。</p>}
        <textarea className="textarea" aria-label="Script text" lang="ja" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={'今日は学校に行きました。\n昨日は雨でした。'} spellCheck={false} rows={10} />
        <div className="btn-row">
          <button className="btn primary small" disabled={action.busy} aria-busy={action.busy} onClick={() => save(draft)}>Save script</button>
          {sentences.length > 0 && <button className="btn small ghost" onClick={() => { setDraft(data.script); setEditing(false) }}>Cancel</button>}
          <button className="btn small" onClick={() => file.current?.click()}><Upload aria-hidden="true" />Import .txt</button>
          <span className="grow" /><span className="meta num">{n ? `${n} sentence${n > 1 ? 's' : ''}` : ''}</span>
        </div>
        {action.error != null && <ErrorNotice error={action.error} />}
        {picker}
      </div>
    )
  }
  const st = aligned ? scriptStatuses(report, cuts) : []
  const counts: Partial<Record<Status, number>> = {}
  for (const x of st) counts[x] = (counts[x] ?? 0) + 1
  return (
    <div className="cut-scroll">
      {stale && <div className="notice script-notice">Script changed since the last analysis.<span className="grow" /><button className="btn small primary" onClick={() => { setStale(false); onAnalyze() }}>Analyse again</button></div>}
      {!report && !stale && data.transcribed && data.settings.no_script && <div className="notice script-notice">Using the script is turned off in the settings.</div>}
      <div className="script-bar">
        {aligned && <span className="meta">{counts.ok ?? 0} read{counts.partial ? ` · ${counts.partial} partly` : ''}{counts.missing ? ` · ${counts.missing} missing` : ''}{counts.cut ? ` · ${counts.cut} cut by your edits` : ''}</span>}
        <span className="grow" />
        <button className="btn small" onClick={onRead} title="Full-screen reading view, for recording"><BookOpen aria-hidden="true" />Read</button>
        <button className="btn small ghost" onClick={() => { setDraft(data.script); setEditing(true) }}>Edit</button>
        <button className="btn small ghost" onClick={() => file.current?.click()}><Upload aria-hidden="true" />Import</button>
        <button className="btn small ghost" onClick={() => { if (window.confirm('Remove the script for this recording?')) { setDraft(''); save('') } }}>Remove</button>
      </div>
      <ol className="script-rows" lang="ja">
        {sentences.map((text, i) => {
          const r = aligned ? report[i] : null, status = aligned ? st[i] : null
          const notes: string[] = []
          if (r && status && status !== 'ok') notes.push(STATUS_TEXT[status] + (status === 'partial' ? ` (${Math.round(r.coverage * 100)}%)` : ''))
          if (r && r.takes > 1) notes.push(`${r.takes} takes, the last complete one kept`)
          const body: ReactNode = <>
            <span className={'mark ' + (status ?? '')} aria-label={status ? STATUS_TEXT[status] : undefined}>{status ? MARK[status] : ''}</span>
            <span className="tc num">{r?.start != null ? fmt(r.start, 0) : ''}</span>
            <span className="said">{text}{notes.length > 0 && <small lang="en">{notes.join(' · ')}</small>}</span>
          </>
          return (
            <li key={i} className={(status ?? '') + (i === now ? ' now' : '')}>
              {r?.start != null ? <button onClick={() => onSeek(r.start!)}>{body}</button> : <div>{body}</div>}
            </li>
          )
        })}
      </ol>
      {picker}
    </div>
  )
}

function Reader({ title, sentences, onClose }: { title: string; sentences: string[]; onClose: () => void }) {
  const [size, setSize] = usePref('cleanup.readerSize', 32)
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current
    el?.showModal(); close.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { el?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return (
    <dialog ref={dialog} className="reader" aria-label="Script reader" onCancel={(e) => { e.preventDefault(); onClose() }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const first = controls[0], last = controls.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }}>
      <div className="reader-bar">
        <b>{title}</b><span className="grow" />
        <button className="btn small" onClick={() => setSize(Math.max(16, size - 4))} aria-label="Smaller text">A−</button>
        <button className="btn small" onClick={() => setSize(Math.min(72, size + 4))} aria-label="Bigger text">A+</button>
        <button ref={close} className="btn small primary" onClick={onClose}>Close <kbd className="kbd">esc</kbd></button>
      </div>
      <ol className="reader-text" lang="ja" style={{ fontSize: size }}>
        {sentences.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </dialog>
  )
}

// ------------------------------------------------------------------ sentences for practice

/** Turn what survives the cuts into the source's practice sentences: the script's
 *  kept takes when there is a script, else the kept utterances of the transcript. */
function MakeSentences({ data, cuts, fromScript, onDone }: { data: Cleanup; cuts: EditCut[]; fromScript: boolean; onDone: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => {
    if (fromScript && data.report) {
      const st = scriptStatuses(data.report, cuts)
      return data.report.filter((r, i) => r.start != null && st[i] !== 'missing' && st[i] !== 'cut').map((r) => ({ text: r.text, start: r.start, end: r.end }))
    }
    return data.utts.map((u) => {
      const kept = u.filter((ch) => !charCut(cuts, ch))
      const spoken = kept.filter((ch) => !PUNCT.test(ch[0]))
      return { text: kept.map((ch) => ch[0]).join('').trim(), start: spoken[0]?.[1] ?? null, end: spoken.at(-1)?.[2] ?? null }
    }).filter((r) => r.text.replace(LOOSE_DROP, '') && r.start != null)
  }, [data, cuts, fromScript])
  if (!rows.length) return null
  const go = async () => {
    if (!window.confirm(`Make ${rows.length} practice sentences from the ${fromScript && data.report ? 'script' : 'transcript, without the cut parts'}? They replace this recording's current sentences and their scores.`)) return
    setBusy(true)
    try { await api.setSentences(data.source, rows); toast({ text: `${rows.length} sentences ready to practise` }); onDone() }
    catch (e) { toast({ text: (e as Error).message }) } finally { setBusy(false) }
  }
  return (
    <span className="btn-row">
      <button className="btn small" disabled={busy} onClick={go} title="Use these as the recording's practice sentences, timed to the audio"><ListPlus aria-hidden="true" />Use as sentences</button>
      <Link className="btn small primary" to={`/practice?source=${data.source}`}><Play aria-hidden="true" />Practise</Link>
    </span>
  )
}

// ------------------------------------------------------------------ settings

function SettingsSheet({ data, busy, onAnalyze }: { data: Cleanup; busy: boolean; onAnalyze: (s: CleanupSettings, retranscribe: boolean) => void }) {
  const d = data.defaults
  const init = () => ({
    cues: (data.settings.cues ?? d.cues).join(', '), fillers: (data.settings.fillers ?? []).join(', '),
    no_fillers: !!data.settings.no_fillers, no_repeats: !!data.settings.no_repeats, no_script: !!data.settings.no_script, no_pauses: !!data.settings.no_pauses,
    cue_back: String(data.settings.cue_back ?? d.cue_back), repeat_threshold: String(data.settings.repeat_threshold ?? d.repeat_threshold),
    utt_gap: String(data.settings.utt_gap ?? d.utt_gap), max_pause: String(data.settings.max_pause ?? d.max_pause),
    pad: String(data.settings.pad ?? d.pad), lead: String(data.settings.lead ?? d.lead), script_match: String(data.settings.script_match ?? d.script_match),
    model: data.settings.model ?? '', device: data.settings.device ?? '', compute_type: data.settings.compute_type ?? '', retranscribe: false,
  })
  const [f, setF] = useState(init)
  const set = (k: keyof ReturnType<typeof init>, v: string | boolean) => setF((o) => ({ ...o, [k]: v }))
  const list = (s: string) => s.split(/[,、]/).map((x) => x.trim()).filter(Boolean)
  const submit = () => onAnalyze({
    cues: list(f.cues), fillers: list(f.fillers), no_fillers: f.no_fillers, no_repeats: f.no_repeats, no_script: f.no_script, no_pauses: f.no_pauses,
    cue_back: +f.cue_back, repeat_threshold: +f.repeat_threshold, utt_gap: +f.utt_gap, max_pause: +f.max_pause, pad: +f.pad, lead: +f.lead,
    script_match: +f.script_match, model: f.model.trim() || undefined, device: f.device || undefined, compute_type: f.compute_type || undefined,
  }, f.retranscribe)
  const num = (k: 'cue_back' | 'repeat_threshold' | 'utt_gap' | 'max_pause' | 'pad' | 'lead' | 'script_match', label: string, step: number, max?: number) => (
    <label className="field"><span>{label}</span>
      <input className="input num" type="number" min={0} max={max} step={step} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  )
  return (
    <section className="sheet cut-settings" aria-label="Analysis settings">
      <div className="cut-settings-grid">
        <fieldset>
          <legend>Retakes and fillers</legend>
          <label className="field"><span>Retake cue words</span><input className="input" lang="ja" value={f.cues} onChange={(e) => set('cues', e.target.value)} placeholder="comma separated" /></label>
          {num('cue_back', 'Utterances cut before a cue said after a pause', 1)}
          <label className="opt"><input type="checkbox" className="check" checked={!f.no_fillers} onChange={(e) => set('no_fillers', !e.target.checked)} />Cut fillers (えーと, あのー…)</label>
          <label className="field"><span>Extra filler patterns</span><input className="input" lang="ja" value={f.fillers} onChange={(e) => set('fillers', e.target.value)} placeholder="comma separated regexes, e.g. なんか" /></label>
        </fieldset>
        <fieldset>
          <legend>Script and repeats</legend>
          <label className="opt"><input type="checkbox" className="check" checked={!f.no_script} onChange={(e) => set('no_script', !e.target.checked)} />Let the script guide the cuts</label>
          {num('script_match', 'Share of an utterance that must be in the script', 0.05, 1)}
          <label className="opt"><input type="checkbox" className="check" checked={!f.no_repeats} onChange={(e) => set('no_repeats', !e.target.checked)} />Cut repeats and false starts (without a script)</label>
          {num('repeat_threshold', 'Repeat similarity', 0.05, 1)}
        </fieldset>
        <fieldset>
          <legend>Timing (seconds)</legend>
          <label className="opt"><input type="checkbox" className="check" checked={!f.no_pauses} onChange={(e) => set('no_pauses', !e.target.checked)} />Automatically trim gaps without speech</label>
          <p className="meta">Turn this off to preserve music, ambience and pauses when analyzing again. Other speech cuts still apply.</p>
          {num('utt_gap', 'Pause between two utterances', 0.05)}
          {num('max_pause', 'Longest pause kept', 0.05)}
          {num('pad', 'Silence kept around a cut', 0.01)}
          {num('lead', 'Silence kept at start and end', 0.05)}
        </fieldset>
        <fieldset>
          <legend>Whisper</legend>
          <label className="field"><span>Model</span>
            <input className="input" list="whisper-models" value={f.model} onChange={(e) => set('model', e.target.value)} placeholder={`automatic: ${d.model}`} />
            <datalist id="whisper-models"><option value="large-v3" /><option value="large-v3-turbo" /><option value="kotoba-tech/kotoba-whisper-v2.0-faster" /><option value="medium" /><option value="small" /></datalist>
          </label>
          <label className="field"><span>Device</span>
            <select className="select input" value={f.device} onChange={(e) => set('device', e.target.value)}>
              <option value="">automatic ({d.device})</option><option value="cuda">GPU (cuda)</option><option value="cpu">CPU</option>
            </select>
          </label>
          <label className="field"><span>Precision</span>
            <select className="select input" value={f.compute_type} onChange={(e) => set('compute_type', e.target.value)}>
              <option value="">automatic ({d.compute_type})</option><option>float16</option><option>int8_float16</option><option>int8</option><option>float32</option>
            </select>
          </label>
          <label className="opt"><input type="checkbox" className="check" checked={f.retranscribe} onChange={(e) => set('retranscribe', e.target.checked)} />Transcribe again</label>
        </fieldset>
      </div>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={submit}><Scissors aria-hidden="true" />{data.transcribed && !f.retranscribe ? 'Analyse with these settings' : 'Transcribe & analyse'}</button>
        <button className="btn ghost" onClick={() => setF({ ...init(), ...Object.fromEntries(Object.entries(d).filter(([k]) => k in f).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? v : String(v)])), fillers: '', model: '', device: '', compute_type: '' })}>
          <RotateCcw aria-hidden="true" />Defaults
        </button>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ job progress

function JobBar({ job, onClose }: { job: Job; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const log = useRef<HTMLPreElement>(null)
  const running = job.state === 'queued' || job.state === 'running'
  useEffect(() => { if (job.state === 'error') setOpen(true) }, [job.state])
  useEffect(() => { const l = log.current; if (l) l.scrollTop = l.scrollHeight }, [job.log.length, open])
  useEffect(() => { if (job.state === 'done') { const t = window.setTimeout(onClose, 2500); return () => window.clearTimeout(t) } }, [job.state, onClose])
  const what = job.kind === 'render' ? 'Rendering the clean take' : 'Transcribing'
  return (
    <div className={'job-bar' + (job.state === 'error' ? ' error' : '')} role="status">
      <div className="job-head">
        <b>{job.state === 'error' ? `${what} failed` : job.state === 'done' ? 'Done' : job.state === 'queued' ? `${what}: waiting for the current job` : what}</b>
        <span className="meta num">{running && job.progress != null ? `${Math.round(job.progress * 100)}%` : ''}</span>
        <span className="grow" />
        <button className="btn small ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide log' : 'Log'}</button>
        {!running && <button className="btn small ghost icon" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>}
      </div>
      <div className={'job-progress' + (running && job.progress == null ? ' indet' : '')}><i style={{ transform: `scaleX(${running ? job.progress ?? 0.3 : 1})` }} /></div>
      {job.error && <p className="job-error">{job.error}</p>}
      {open && <pre ref={log} lang="ja">{job.log.join('\n') || '…'}</pre>}
    </div>
  )
}
