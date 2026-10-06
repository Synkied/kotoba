import { ArrowDown, ArrowUp, ChevronLeft, Play, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { api, type Sentence } from '../lib/api'
import { Balloon } from '../components/Balloon'
import { Furigana } from '../components/Furigana'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { ErrorNotice, Skeleton, useAsync, usePref, useToast } from '../components/ui'

export default function DeckPage() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const toast = useToast()
  const [furigana] = usePref('furigana', true)
  const deck = useAsync(() => api.deck(id), [id])
  const list = useAsync(() => api.sentences({ deck: id }), [id])
  const [name, setName] = useState<string | null>(null)
  const items = list.data?.results ?? []

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    list.set({ ...list.data!, results: next })
    await api.orderDeck(id, next.map((s) => s.id))
  }
  const remove = async (s: Sentence) => {
    list.set({ ...list.data!, results: items.filter((x) => x.id !== s.id) })
    await api.removeFromDeck(id, [s.id])
    toast({ text: 'Removed from the deck', undo: async () => { await api.addToDeck(id, [s.id]); list.reload() } })
  }

  if (deck.error) return <ErrorNotice error={deck.error} />
  if (!deck.data) return <Skeleton rows={3} />
  return (
    <>
      <header className="page-head">
        <Link className="btn icon ghost" to="/decks" aria-label="All decks"><ChevronLeft aria-hidden="true" /></Link>
        {name === null ? (
          <h1><button className="btn ghost" style={{ font: 'inherit', height: 'auto', padding: 0 }} title="Rename" onClick={() => setName(deck.data!.name)}>{deck.data.name}</button>
            <span className="meta num">{items.length} sentences</span></h1>
        ) : (
          <form className="btn-row" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) deck.set(await api.updateDeck(id, { name: name.trim() })); setName(null) }}>
            <label><span className="sr">Deck name</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} /></label>
            <button className="btn small primary">Save</button>
          </form>
        )}
        <span className="grow" />
        <button className="btn ghost" onClick={async () => { if (window.confirm(`Delete the deck “${deck.data!.name}”? Its sentences stay in the library.`)) { await api.deleteDeck(id); nav('/decks') } }}><Trash2 aria-hidden="true" />Delete deck</button>
        {items.length > 0 && <Link className="btn red" to={`/practice?deck=${id}`}><Play aria-hidden="true" />Practise</Link>}
      </header>
      {list.loading && !list.data ? <Skeleton /> : !items.length ? (
        <div className="empty">
          <h2>This deck is empty</h2>
          <p>Select sentences in the library, the inbox or a source, then choose “Add to deck → {deck.data.name}”.</p>
          <Link className="btn primary" to="/library">Open the library</Link>
        </div>
      ) : (
        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((s, k) => (
            <li className="row" key={s.id} style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
              <div className="lead">
                <span className="tc num" aria-hidden="true">{String(k + 1).padStart(2, '0')}</span>
                <SourcePanel kind={s.source_kind} image={s.image} start={s.start} end={s.end} alt="" />
              </div>
              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <Balloon><Furigana text={s.text} pairs={s.furigana} show={furigana} /></Balloon>
                <span className="meta" style={{ paddingLeft: 18 }}><Link to={`/sources/${s.source}`}>{s.source_title}</Link>{s.start != null && <> · <span className="num">{fmtTime(s.start)}</span></>}</span>
              </div>
              <div className="acts">
                <Stamps stamps={s.stamps} max={3} />
                <button className="btn small icon ghost" onClick={() => reorder(k, k - 1)} disabled={k === 0} aria-label="Move up"><ArrowUp aria-hidden="true" /></button>
                <button className="btn small icon ghost" onClick={() => reorder(k, k + 1)} disabled={k === items.length - 1} aria-label="Move down"><ArrowDown aria-hidden="true" /></button>
                <button className="btn small icon ghost" onClick={() => remove(s)} aria-label="Remove from deck"><X aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
