import { Plus, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ErrorNotice, Skeleton, useAsync, useAction } from '../components/ui'

export default function DecksPage() {
  const { data, error, loading, reload } = useAsync(() => api.decks(), [])
  const [name, setName] = useState('')
  const nav = useNavigate()
  const action = useAction()
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await action.run(async () => { const d = await api.createDeck(name.trim()); nav(`/decks/${d.id}`) })
  }
  const decks = data?.results ?? []
  return (
    <>
      <header className="page-head">
        <h1>Decks <span className="meta num">{data ? data.count : ''}</span></h1>
        <span className="grow" />
        <form onSubmit={create} className="btn-row">
          <label><span className="sr">New deck name</span><input className="input" style={{ width: '16rem' }} placeholder="New deck, e.g. Lesson 19" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn primary" aria-busy={action.busy} disabled={!name.trim() || action.busy}><Plus aria-hidden="true" />Create</button>
        </form>
      </header>
      {action.error != null && <ErrorNotice error={action.error} />}
      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !decks.length ? (
          <div className="empty">
            <h2>No decks yet</h2>
            <p>A deck is an ordered run of sentences you practise together: a lesson, an episode, a game chapter. Create one here, or pick sentences in the library and choose “Add to deck”.</p>
            <Link className="btn" to="/library">Open the library</Link>
          </div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Decks"><table className="deck-table">
            <thead><tr>
              <th>Deck</th><th className="n">Sentences</th><th className="n hide-s">Practised</th><th className="hide-s">Progress</th>
              <th className="n hide-s">Average</th><th className="n">Due</th><th><span className="sr">Actions</span></th>
            </tr></thead>
            <tbody>
              {decks.map((d) => (
                <tr key={d.id}>
                  <td><Link className="name" to={`/decks/${d.id}`}>{d.name}</Link>{d.description && <div className="meta">{d.description}</div>}</td>
                  <td className="n">{d.size}</td>
                  <td className="n hide-s">{d.practised}</td>
                  <td className="hide-s"><span className="meter" role="img" aria-label={`${d.practised} of ${d.size} practised`}><i style={{ width: d.size ? `${(100 * d.practised) / d.size}%` : 0 }} /></span></td>
                  <td className="n hide-s">{d.average != null ? Math.round(d.average) : '–'}</td>
                  <td className="n">{d.due ? <span className="plate red">{d.due}</span> : <span className="meta">0</span>}</td>
                  <td style={{ textAlign: 'right' }}>{d.size > 0 && <Link className="btn small" to={`/practice?deck=${d.id}`}><Play aria-hidden="true" />Practise</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
    </>
  )
}
