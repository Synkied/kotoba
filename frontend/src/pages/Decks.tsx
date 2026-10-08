import { Folder, Pencil, Plus, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, byFolder, type Deck } from '../lib/api'
import { ErrorNotice, Skeleton, useAsync, useAction } from '../components/ui'

export default function DecksPage() {
  const { data, error, loading, reload, set } = useAsync(() => api.decks(), [])
  const [name, setName] = useState('')
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const action = useAction()
  const decks = data?.results ?? []
  const groups = byFolder(decks)
  const foldered = groups.some(([f]) => f)
  // ?folder=Name shows one folder, ?folder= the decks in none, no param all of them
  const asked = params.has('folder') ? params.get('folder')! : null
  const open = asked !== null && groups.some(([f]) => f === asked) ? asked : null
  const show = (folder: string | null) => setParams(folder === null ? {} : { folder }, { replace: true })
  const shown = open === null ? groups : groups.filter(([f]) => f === open)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await action.run(async () => { const d = await api.createDeck(name.trim(), open ?? ''); nav(`/decks/${d.id}`) })
  }
  const rename = async (folder: string) => {
    const to = window.prompt(`Rename the folder “${folder}”. Leave it empty to take its decks out of any folder.`, folder)
    if (to === null || to.trim() === folder) return
    await action.run(async () => {
      const moved = await Promise.all(decks.filter((d) => d.folder === folder).map((d) => api.updateDeck(d.id, { folder: to })))
      const byId = new Map(moved.map((d) => [d.id, d]))
      set({ ...data!, results: decks.map((d) => byId.get(d.id) ?? d) })
      show(moved[0]?.folder ?? null)
    })
  }

  return (
    <>
      <header className="page-head">
        <h1>Decks <span className="meta num">{data ? data.count : ''}</span></h1>
        <span className="grow" />
        <form onSubmit={create} className="btn-row">
          <label><span className="sr">New deck name</span><input className="input" style={{ width: '16rem' }} placeholder={open ? `New deck in ${open}` : 'New deck, e.g. Lesson 19'} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn primary" aria-busy={action.busy} disabled={!name.trim() || action.busy}><Plus aria-hidden="true" />Create</button>
        </form>
      </header>
      {action.error != null && <ErrorNotice error={action.error} />}
      {foldered && (
        <div className="filters">
          <div className="group" role="group" aria-label="Folders">
            <span className="meta">Folder</span>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={open === null} onClick={() => show(null)}>All <span className="n">{decks.length}</span></button>
              {groups.map(([f, ds]) => (
                <button type="button" className="chip" key={f} aria-pressed={open === f} onClick={() => show(f)}>
                  {f || 'No folder'} <span className="n">{ds.length}</span>
                </button>
              ))}
            </div>
            {open && <button type="button" className="btn small ghost" disabled={action.busy} onClick={() => rename(open)}><Pencil aria-hidden="true" />Rename folder</button>}
          </div>
        </div>
      )}
      {error ? <ErrorNotice error={error} action={<button className="btn small" onClick={reload}>Try again</button>} /> :
        loading && !data ? <Skeleton /> :
        !decks.length ? (
          <div className="empty">
            <h2>No decks yet</h2>
            <p>A deck is an ordered run of sentences you practise together: a lesson, an episode, a game chapter. Create one here, or pick sentences in the library and choose “Add to deck”. Put related decks in a folder from the deck’s page.</p>
            <Link className="btn" to="/library">Open the library</Link>
          </div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Decks"><table className="deck-table">
            <thead><tr>
              <th>Deck</th><th className="n">Sentences</th><th className="n hide-s">Practised</th><th className="hide-s">Progress</th>
              <th className="n hide-s">Average</th><th className="n">Due</th><th><span className="sr">Actions</span></th>
            </tr></thead>
            {shown.map(([f, ds]) => (
              <tbody key={f}>
                {foldered && open === null && (
                  <tr className="folder-row"><th colSpan={7} scope="rowgroup">
                    <button type="button" className="link" onClick={() => show(f)}>{f ? <><Folder aria-hidden="true" />{f}</> : 'No folder'}</button>
                    <span className="meta num">{ds.length} deck{ds.length > 1 ? 's' : ''}</span>
                  </th></tr>
                )}
                {ds.map((d) => <DeckRow key={d.id} d={d} />)}
              </tbody>
            ))}
          </table></div>
        )}
    </>
  )
}

function DeckRow({ d }: { d: Deck }) {
  return (
    <tr>
      <td><Link className="name" to={`/decks/${d.id}`}>{d.name}</Link>{d.description && <div className="meta">{d.description}</div>}</td>
      <td className="n">{d.size}</td>
      <td className="n hide-s">{d.practised}</td>
      <td className="hide-s"><span className="meter" role="img" aria-label={`${d.practised} of ${d.size} practised`}><i style={{ width: d.size ? `${(100 * d.practised) / d.size}%` : 0 }} /></span></td>
      <td className="n hide-s">{d.average != null ? Math.round(d.average) : '–'}</td>
      <td className="n">{d.due ? <span className="plate red">{d.due}</span> : <span className="meta">0</span>}</td>
      <td style={{ textAlign: 'right' }}>{d.size > 0 && <Link className="btn small" to={`/practice?deck=${d.id}`}><Play aria-hidden="true" />Practise</Link>}</td>
    </tr>
  )
}
