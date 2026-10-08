import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Addons } from '../lib/api'
import { ErrorNotice, Skeleton, dayLabel, clock } from '../components/ui'
import { CopyButton } from './Library'

type Dot = 'ok' | 'warn' | 'off'

/** What this kotoba can do on this machine: each optional piece, whether it's there,
 *  and the one command that adds it. */
export default function AddonsPage() {
  const [a, setA] = useState<Addons | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const poll = () => api.addons().then((x) => { if (live) { setA(x); setError(null) } }, (e) => live && setError(e))
    poll()
    const t = window.setInterval(poll, 4000)
    return () => { live = false; window.clearInterval(t) }
  }, [])
  if (error && !a) return <ErrorNotice error={error} />
  if (!a) return <Skeleton rows={3} />

  const w = a.whisper
  const whisper: [Dot, string] = !a.ffmpeg ? ['off', 'ffmpeg is missing'] :
    w.state === 'missing' ? ['off', 'Not installed'] :
      w.state === 'ready' ? ['ok', `Loaded: ${w.key.join(' · ')}`] :
        w.state === 'loading' ? ['warn', 'Loading the model…'] :
          w.state === 'error' ? ['off', `Failed to load: ${w.error}`] : ['warn', `Installed; loads on first use (${w.key.join(' · ')})`]
  const v = a.voices
  const voice: [Dot, string] = v.kokoro === 'loading' ? ['warn', 'Loading Kokoro…'] : v.count ? ['ok', `${v.count} voices${v.voicevox ? ', VOICEVOX connected' : ''}`] :
    v.kokoro === 'error' ? ['off', v.kokoro_error ?? 'Kokoro failed'] : ['off', 'Only the browser\'s voices']
  const last = a.screen_ocr.last_capture
  const ocr: [Dot, string] = last ? ['ok', `Last capture ${dayLabel(last).rel || dayLabel(last).date}, ${clock(last)}`] : ['off', 'No captures yet']
  const q = a.queue

  return (
    <>
      <header className="page-head"><h1>Add-ons</h1></header>
      {error != null && <ErrorNotice error={error} />}
      <section className="sheet addons">
        <p>kotoba keeps and organises your sentences on its own. These pieces add listening and speaking. Each one is optional, and the hub works without them.</p>

        <Addon dot={whisper} name="Speaking scores and transcription" by="Whisper">
          <p className="meta">Scores what you say in practice, transcribes uploaded audio and video into timed sentences, and finds the cuts in your recordings. Works on a CPU; a GPU makes it much faster.</p>
          {w.state === 'missing' || !a.ffmpeg ? (
            <Install cmds={[...(!a.ffmpeg ? ['# ffmpeg, from your package manager, e.g.', 'sudo apt install ffmpeg'] : []),
              ...(w.state === 'missing' ? ['make install EXTRAS=whisper    # or: uv sync --extra whisper'] : [])]} />
          ) : (w.state === 'idle' || w.state === 'error') && (
            <div><button className="btn small" disabled={busy} onClick={async () => { setBusy(true); try { await api.engineLoad() } catch (err) { setError(err) } finally { setBusy(false) } }}>Load Whisper now</button></div>
          )}
          {(q.waiting > 0 || q.failed > 0 || q.jobs.length > 0) && (
            <p className="meta">
              {q.jobs.filter((j) => j.state === 'running').map((j) => <span key={j.id}>Working on <b>{j.title}</b>{j.progress != null && ` (${Math.round(j.progress * 100)}%)`}. </span>)}
              {q.waiting > 0 && <>{q.waiting} upload{q.waiting > 1 ? 's' : ''} waiting to be transcribed. </>}
              {q.failed > 0 && <><Link to="/inbox">{q.failed} failed</Link>; open them in the inbox to see why.</>}
            </p>
          )}
        </Addon>

        <Addon dot={voice} name="Voices" by="Kokoro · VOICEVOX">
          <p className="meta">Reads sentences aloud when there's no native audio. Kokoro runs inside kotoba; VOICEVOX (or AivisSpeech) is a separate app with many more voices, found at <code className="inline">{v.voicevox_url}</code>.</p>
          {v.kokoro === 'missing' && <Install cmds={['make install EXTRAS=voice    # Kokoro, then: uv run python -m unidic download']} />}
        </Addon>

        <Addon dot={ocr} name="Screen captures" by="screen-ocr">
          <p className="meta">Press a hotkey and drag over text on screen: the text and its screenshot land in the inbox, queued offline when kotoba isn't reachable. It runs on the computer you read on.</p>
          <Install cmds={['make ocr-client', `screen-ocr --server ${window.location.origin}`]} />
        </Addon>
      </section>
    </>
  )
}

function Addon({ dot, name, by, children }: { dot: [Dot, string]; name: string; by: string; children: React.ReactNode }) {
  return (
    <div className="addon">
      <span className={'dot ' + dot[0]} aria-hidden="true" />
      <h2>{name} <span className="meta" style={{ fontWeight: 400 }}>{by}</span></h2>
      <span className="meta addon-state">{dot[1]}</span>
      <div className="addon-body">{children}</div>
    </div>
  )
}

function Install({ cmds }: { cmds: string[] }) {
  const text = cmds.join('\n')
  return (
    <div className="install">
      <code className="code">{text}</code>
      <CopyButton text={cmds.filter((c) => !c.startsWith('#')).map((c) => c.replace(/\s+#.*$/, '')).join('\n')} />
    </div>
  )
}
