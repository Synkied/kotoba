import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../lib/api'
import { ErrorNotice, Skeleton, useAsync } from '../components/ui'
import { Balloon } from '../components/Balloon'
import { Stamps } from '../components/Stamp'
import { PracticeSession } from './Practice'

const when = (iso: string) => {
  const d = new Date(iso), mins = Math.round((d.getTime() - Date.now()) / 60000)
  if (mins < 60) return `in ${Math.max(1, mins)} min`
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)} h`
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function ReviewPage() {
  const { data, error, loading, reload } = useAsync(() => api.review(), [])
  const [running, setRunning] = useState(false)
  if (error) return <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} />
  if (loading || !data) return <Skeleton rows={3} />
  const queue = [...data.due, ...data.new]
  if (running) return <PracticeSession title="Review" back="/review" sentences={queue} onFinish={() => { setRunning(false); reload() }} />

  return (
    <>
      <header className="page-head">
        <h1>Review <span className="meta num">{data.due.length ? `${data.due.length} due` : 'nothing due'}</span></h1>
      </header>
      {queue.length ? (
        <section style={{ display: 'grid', gap: 'var(--s-5)', maxWidth: '48rem' }}>
          <p style={{ color: 'var(--ink-2)' }}>
            {data.due.length ? `${data.due.length} sentence${data.due.length > 1 ? 's' : ''} scored low or are due again.` : ''}
            {data.new.length ? ` ${data.new.length} new from your library join them.` : ''}
          </p>
          <div><button className="btn red" style={{ height: 48, padding: '0 var(--s-6)', fontSize: 'var(--t-m)' }} onClick={() => setRunning(true)} autoFocus>Start review</button></div>
          <div className="rows">
            {queue.slice(0, 12).map((s, k) => (
              <div className="row" key={s.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <Balloon tail="none" dim={k > 4}>{s.text}</Balloon>
                <div className="acts">{s.last == null ? <span className="plate hollow">new</span> : <Stamps stamps={s.stamps} max={3} />}</div>
              </div>
            ))}
            {queue.length > 12 && <p className="meta" style={{ paddingTop: 'var(--s-3)' }}>+ {queue.length - 12} more</p>}
          </div>
        </section>
      ) : (
        <div className="empty">
          <h2>All caught up</h2>
          <p>{data.next_due ? `The next sentence comes back ${when(data.next_due)}.` : 'Practise a deck and the sentences you score under 70 come back here, spaced out until they stick.'}</p>
          <Link className="btn primary" to="/decks">Practise a deck</Link>
        </div>
      )}
    </>
  )
}
