import { Clock, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type TranscriptionQueue } from '../lib/api'
import { ErrorNotice } from '../components/ui'

export default function TranscriptionsPage() {
  const [data, setData] = useState<TranscriptionQueue | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: number
    const poll = async () => {
      try {
        const next = await api.transcriptions(controller.signal)
        if (!controller.signal.aborted) { setData(next); setError(null) }
      } catch (e) {
        if (!controller.signal.aborted) setError(e)
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 4000)
      }
    }
    poll()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [retry])

  const ongoing = data?.items.filter((j) => j.state === 'running') ?? []
  const waiting = data?.items.filter((j) => j.state === 'queued') ?? []

  return <>
    <header className="page-head">
      <h1>Transcriptions</h1>
      <span className="grow" />
      <Link className="btn" to="/collect">Add audio or video</Link>
    </header>
    <p className="meta">Audio and video become timed sentences here. This page updates automatically.</p>
    {error != null && <ErrorNotice error={error} action={<button className="btn small" onClick={() => setRetry((n) => n + 1)}>Try again</button>} />}
    {!data && error == null && <p className="transcription-loading" role="status"><LoaderCircle className="loading-spinner" aria-hidden="true" />Loading transcriptions…</p>}
    {data && <>
      {!data.can_transcribe && data.items.length > 0 && <p className="notice">Transcription needs Whisper and ffmpeg. <Link to="/addons">Check transcription setup</Link>.</p>}
      <p className="sr" role="status">{ongoing.length} ongoing, {waiting.length} waiting.</p>
      <QueueSection title="Ongoing" items={ongoing} />
      <QueueSection title="Waiting" items={waiting} />
      {data.items.length === 0 && <div className="empty">
        <h2>No transcriptions in the queue</h2>
        <p>Completed transcripts are available in Sources and Library.</p>
        <Link className="btn" to="/sources">Browse sources</Link>
      </div>}
    </>}
  </>
}

function QueueSection({ title, items }: { title: string; items: TranscriptionQueue['items'] }) {
  const running = title === 'Ongoing'
  return <section className="transcription-section" aria-label={title}>
    <h2>{title} <span className="meta num">{items.length}</span></h2>
    {items.length === 0 ? <p className="meta">{running ? 'Nothing is being transcribed right now.' : 'Nothing is waiting.'}</p> :
      <ul className="rec-list">{items.map((item, index) => {
        const progress = item.progress == null ? null : Math.round(Math.max(0, Math.min(1, item.progress)) * 100)
        return <li className="transcription-row" key={item.source}>
          {running ? <LoaderCircle className="loading-spinner" aria-hidden="true" /> : <Clock aria-hidden="true" />}
          <div className="transcription-main">
            <Link to={`/sources/${item.source}`}>{item.title}</Link>
            <span className="meta">{running ? 'Transcribing…' : `Waiting · ${index + 1} in queue`}{running && progress != null && ` · ${progress}%`}</span>
            {running && progress != null && <progress value={progress} max={100} aria-label={`Transcription progress for ${item.title}`} />}
          </div>
          <Link className="btn small" to={`/sources/${item.source}`}>Open source</Link>
        </li>
      })}</ul>}
  </section>
}
