import { Mic, Upload, Scissors, FileAudio, Film } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Recording } from '../lib/api'
import { fmtTime } from '../components/SourcePanel'
import { ErrorNotice, Skeleton, dayLabel, useAsync, useToast, PageHome } from '../components/ui'
import { Button, ButtonLink, Chip, EmptyState, Plate } from '../components/ds'
import { SourcesTabs } from '../components/SourcesTabs'

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
      if (media.length === 1) nav(`/sources/${last}/cleanup`)
      else { toast({ text: `${media.length} recordings added; they're being transcribed` }); reload() }
    } catch (e) {
      reload(); toast({ text: `${added ? `${added} recordings added. ` : ''}${(e as Error).message}` })
    } finally { setBusy(false); locked.current = false }
  }

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/sources/recordings">Recordings</PageHome> {data && <span className="meta num">{data.length}</span>}</h1>
        <span className="grow" />
        <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}><Upload aria-hidden="true" />Add a recording</Button>
        <input ref={input} type="file" accept="audio/*,video/*" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = '' }} />
      </header>
      <SourcesTabs />

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
            <EmptyState>
              <h2>Record yourself reading, then clean it up</h2>
              <p>Drop a recording here. kotoba transcribes it, finds your retakes (say リテイク after a slip), fillers like えーと, repeated starts and long pauses, and lets you review every cut before rendering a clean take.</p>
              <p className="meta">Any audio or video you collect shows up here too.</p>
            </EmptyState>
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
          <Link to={`/sources/${r.id}/cleanup`}>{r.title}</Link>
          <span className="meta">
            {date}{r.duration ? <> · <span className="num">{fmtTime(r.duration)}</span></> : null}
            {r.sentences > 0 && <> · {r.sentences} sentences</>}
            {r.script && <> · script</>}
            {r.labels.map((l) => <Chip key={l}>{l}</Chip>)}
          </span>
        </span>
        <span className="rec-steps" aria-label={steps.filter((s) => s[0]).map((s) => s[1]).join(', ') || 'not started'}>
          {r.job === 'waiting' || r.job === 'running'
            ? <Plate tone="hollow">{r.job === 'running' ? 'transcribing…' : 'waiting to transcribe'}</Plate>
            : r.job === 'failed' ? <Plate tone="accent">transcription failed</Plate>
              : steps.map(([done, name]) => <i key={name} className={done ? 'on' : ''} title={name} />)}
        </span>
        <ButtonLink size="small" to={`/sources/${r.id}/cleanup`}><Scissors aria-hidden="true" />{r.rendered ? 'Edit' : 'Clean up'}</ButtonLink>
      </div>
    </li>
  )
}
