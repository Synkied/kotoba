import { Mic, Upload, Scissors, FileAudio, Film } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Recording } from '../lib/api'
import { fmtTime } from '../components/SourcePanel'
import { ErrorNotice, Skeleton, dayLabel, useAsync, useToast } from '../components/ui'

/** Your recordings (and any collected audio/video): open one to cut retakes, fillers
 *  and pauses, then render a clean take. */
export default function RecordingsPage() {
  const { data, error, reload } = useAsync(() => api.recordings(), [])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const nav = useNavigate()

  const upload = async (files: File[]) => {
    if (locked.current) return
    const media = files.filter((f) => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|m4a|flac|ogg|opus|aac|webm|mp4|mkv|mov)$/i.test(f.name))
    if (!media.length) { toast({ text: 'Drop an audio or video file' }); return }
    locked.current = true; setBusy(true)
    let added = 0
    try {
      let last = 0
      for (const f of media) { last = (await api.collectFile(f)).id; added++ }
      if (media.length === 1) nav(`/recordings/${last}`)
      else { toast({ text: `${media.length} recordings added; they're being transcribed` }); reload() }
    } catch (e) {
      reload(); toast({ text: `${added ? `${added} recordings added. ` : ''}${(e as Error).message}` })
    } finally { setBusy(false); locked.current = false }
  }

  return (
    <>
      <header className="page-head">
        <h1>Recordings {data && <span className="meta num">{data.length}</span>}</h1>
        <span className="grow" />
        <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}><Upload aria-hidden="true" />Add a recording</button>
        <input ref={input} type="file" accept="audio/*,video/*" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = '' }} />
      </header>

      {error && <ErrorNotice error={error} />}
      {!data && !error && <Skeleton rows={4} />}
      {data && (
        <div
          className={'rec-drop' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]) }}
        >
          {data.length === 0 ? (
            <div className="empty">
              <h2>Record yourself reading, then clean it up</h2>
              <p>Drop a recording here. kotoba transcribes it, finds your retakes (say リテイク after a slip), fillers like えーと, repeated starts and long pauses, and lets you review every cut before rendering a clean take.</p>
              <p className="meta">Any audio or video you collect shows up here too.</p>
            </div>
          ) : (
            <ul className="rec-list">
              {data.map((r) => <Row key={r.id} r={r} />)}
              <li className="rec-hint meta"><Mic aria-hidden="true" />Drop more recordings anywhere on this page</li>
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function Row({ r }: { r: Recording }) {
  const { date } = dayLabel(r.created_at)
  const Icon = r.kind === 'video' ? Film : FileAudio
  const steps: [boolean, string][] = [[r.transcribed, 'transcribed'], [r.edited, 'cuts reviewed'], [r.rendered, 'rendered']]
  return (
    <li>
      <div className="rec-row">
        <span className="rec-icon" aria-hidden="true"><Icon /></span>
        <span className="rec-main">
          <Link to={`/recordings/${r.id}`}>{r.title}</Link>
          <span className="meta">
            {date}{r.duration ? <> · <span className="num">{fmtTime(r.duration)}</span></> : null}
            {r.sentences > 0 && <> · {r.sentences} sentences</>}
            {r.script && <> · script</>}
            {r.labels.map((l) => <span key={l} className="chip">{l}</span>)}
          </span>
        </span>
        <span className="rec-steps" aria-label={steps.filter((s) => s[0]).map((s) => s[1]).join(', ') || 'not started'}>
          {r.job === 'waiting' || r.job === 'running'
            ? <span className="plate hollow">{r.job === 'running' ? 'transcribing…' : 'waiting to transcribe'}</span>
            : r.job === 'failed' ? <span className="plate red">transcription failed</span>
              : steps.map(([done, name]) => <i key={name} className={done ? 'on' : ''} title={name} />)}
        </span>
        <Link className="btn small" to={`/recordings/${r.id}`}><Scissors aria-hidden="true" />{r.rendered ? 'Edit' : 'Clean up'}</Link>
      </div>
    </li>
  )
}
