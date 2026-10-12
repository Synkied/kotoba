import { useState } from 'react'
import { api } from '../lib/api'
import { ErrorNotice, Skeleton, useAsync, usePref, PageHome } from '../components/ui'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { Stamps } from '../components/Stamp'
import { PracticeSession } from './Practice'
import { Button, ButtonLink, EmptyState, Plate } from '../components/ds'

const when = (iso: string) => {
  const d = new Date(iso), mins = Math.round((d.getTime() - Date.now()) / 60000)
  if (mins < 60) return `in ${Math.max(1, mins)} min`
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)} h`
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function ReviewPage() {
  const { data, error, loading, reload } = useAsync(() => api.review(), [])
  const [furigana] = usePref('furigana', true)
  const [running, setRunning] = useState(false)
  if (error) return <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} />
  if (loading || !data) return <Skeleton rows={3} />
  const queue = [...data.due, ...data.new]
  if (running) return <PracticeSession title="Review" back="/review" sentences={queue} onFinish={() => { setRunning(false); reload() }} />

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/review">Review</PageHome> <span className="meta num">{data.due.length ? `${data.due.length} due` : 'nothing due'}</span></h1>
      </header>
      {queue.length ? (
        <section style={{ display: 'grid', gap: 'var(--s-5)', maxWidth: '48rem' }}>
          <p style={{ color: 'var(--ink-2)' }}>
            {data.due.length ? `${data.due.length} sentence${data.due.length > 1 ? 's' : ''} scored low or are due again.` : ''}
            {data.new.length ? ` ${data.new.length} new from your sources join them.` : ''}
          </p>
          <div><Button variant="primary" style={{ height: 48, padding: '0 var(--s-6)', fontSize: 'var(--t-m)' }} onClick={() => setRunning(true)} autoFocus>Start review</Button></div>
          <div className="rows">
            {queue.slice(0, 12).map(s => (
              <div className="row row-simple" key={s.id}>
                <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} /></SentenceText>
                <div className="acts"><ButtonLink variant="ghost" size="small" to={`/sentences/${s.id}`}>Details</ButtonLink>{s.last == null ? <Plate tone="hollow">new</Plate> : <Stamps stamps={s.stamps} max={3} />}</div>
              </div>
            ))}
            {queue.length > 12 && <p className="meta" style={{ paddingTop: 'var(--s-3)' }}>+ {queue.length - 12} more</p>}
          </div>
        </section>
      ) : (
        <EmptyState>
          <h2>All caught up</h2>
          <p>{data.next_due ? `The next sentence comes back ${when(data.next_due)}.` : 'Practise a deck and the sentences you score under 70 come back here, spaced out until they stick.'}</p>
          <ButtonLink variant="primary" to="/decks">Practise a deck</ButtonLink>
        </EmptyState>
      )}
    </>
  )
}
