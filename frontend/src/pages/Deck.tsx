import { ArrowDown, ArrowUp, ChevronLeft, Play, Square, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { api, allSentences, type Sentence } from '../lib/api'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SourcePanel, fmtTime } from '../components/SourcePanel'
import { Stamps } from '../components/Stamp'
import { playClip, speak, stopAudio } from '../lib/audio'
import { ErrorNotice, Skeleton, useAsync, usePref, useToast, useAction } from '../components/ui'

export default function DeckPage() {
  const id = Number(useParams().id)
  return <DeckPageDetail key={id} id={id} />
}

function DeckPageDetail({ id }: { id: number }) {
  const nav = useNavigate()
  const toast = useToast()
  const [furigana] = usePref('furigana', true)
  const [voice] = usePref<string>('voice', 'browser')
  const [playing, setPlaying] = useState<number | null>(null)
  const playback = useRef(0)
  const speechRequest = useRef<AbortController | null>(null)
  const deck = useAsync(() => api.deck(id), [id])
  const list = useAsync(() => allSentences({ deck: id }), [id])
  const action = useAction()
  const [name, setName] = useState<string | null>(null)
  const items = list.data?.results ?? []

  useEffect(() => () => { playback.current++; speechRequest.current?.abort(); stopAudio() }, [])

  const listen = async (s: Sentence) => {
    const request = ++playback.current
    speechRequest.current?.abort()
    stopAudio()
    if (playing === s.id) { setPlaying(null); return }
    setPlaying(s.id)
    try {
      if (s.has_audio && s.start != null && s.end != null) {
        const source = await api.source(s.source)
        if (request !== playback.current) return
        if (!source.media) throw new Error('This sentence’s audio is unavailable. Try again or open its source.')
        await playClip(source.media, s.start, s.end)
      } else {
        const controller = new AbortController()
        speechRequest.current = controller
        await speak(s.text, voice, 1, controller.signal)
      }
    } catch (error) {
      if (request === playback.current) toast({ text: error instanceof Error ? error.message : 'Audio could not be played. Try again.' })
    } finally {
      if (request === playback.current) setPlaying(null)
    }
  }

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    await action.run(async () => { await api.orderDeck(id, next.map((s) => s.id)); list.set({ ...list.data!, results: next }) })
  }
  const remove = async (s: Sentence) => {
    await action.run(async () => {
    await api.removeFromDeck(id, [s.id])
    if (playing === s.id) { playback.current++; speechRequest.current?.abort(); stopAudio(); setPlaying(null) }
    list.set({ ...list.data!, count: list.data!.count - 1, results: items.filter((x) => x.id !== s.id) })
    deck.reload()
    toast({ text: 'Removed from the deck', undo: async () => { await api.addToDeck(id, [s.id]); list.reload(); deck.reload() } })
    })
  }

  if (deck.error) return <ErrorNotice error={deck.error} action={<button className="btn" onClick={deck.reload}>Try again</button>} />
  if (!deck.data) return <Skeleton rows={3} />
  return (
    <>
      {action.error != null && <ErrorNotice error={action.error} />}
      <fieldset className="action-scope" disabled={action.busy} aria-busy={action.busy}>
      <header className="page-head">
        <Link className="btn icon ghost" to="/decks" aria-label="All decks"><ChevronLeft aria-hidden="true" /></Link>
        {name === null ? (
          <h1><button className="btn ghost" style={{ font: 'inherit', height: 'auto', padding: 0 }} title="Rename" onClick={() => setName(deck.data!.name)}>{deck.data.name}</button>
            <span className="meta num">{items.length} sentences</span></h1>
        ) : (
          <form className="btn-row" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) await action.run(async () => { deck.set(await api.updateDeck(id, { name: name.trim() })); setName(null) }) }}>
            <label><span className="sr">Deck name</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} /></label>
            <button className="btn small primary">Save</button>
          </form>
        )}
        <span className="grow" />
        <button className="btn ghost" onClick={async () => { if (window.confirm(`Delete the deck “${deck.data!.name}”? Its sentences stay in the library.`)) { await action.run(async () => { await api.deleteDeck(id); nav('/decks') }) } }}><Trash2 aria-hidden="true" />Delete deck</button>
        {items.length > 0 && <Link className="btn primary" to={`/practice?deck=${id}`}><Play aria-hidden="true" />Practise</Link>}
      </header>
      {list.error ? <ErrorNotice error={list.error} action={<button className="btn" onClick={list.reload}>Try again</button>} /> : list.loading && !list.data ? <Skeleton /> : !items.length ? (
        <div className="empty">
          <h2>This deck is empty</h2>
          <p>Select sentences in the library, the inbox or a source, then choose “Add to deck → {deck.data.name}”.</p>
          <Link className="btn primary" to="/library">Open the library</Link>
        </div>
      ) : (
        <ol className="rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((s, k) => (
            <li className="row row-lead" key={s.id}>
              <div className="lead">
                <span className="tc num" aria-hidden="true">{String(k + 1).padStart(2, '0')}</span>
                <SourcePanel kind={s.source_kind} image={s.image} start={s.start} end={s.end} alt="" />
              </div>
              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} /></SentenceText>
                <span className="meta"><Link to={`/sources/${s.source}`}>{s.source_title}</Link>{s.start != null && <> · <span className="num">{fmtTime(s.start)}</span></>}</span>
              </div>
              <div className="acts">
                <button className="btn small ghost" onClick={() => void listen(s)} aria-label={`${playing === s.id ? 'Stop audio' : 'Listen to sentence'} ${k + 1}`}>
                  {playing === s.id ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}{playing === s.id ? 'Stop' : 'Listen'}
                </button>
                <Link className="btn small ghost" to={`/sentences/${s.id}`}>Details</Link>
                <Stamps stamps={s.stamps} max={3} />
                <button className="btn small icon ghost" onClick={() => reorder(k, k - 1)} disabled={k === 0} aria-label="Move up"><ArrowUp aria-hidden="true" /></button>
                <button className="btn small icon ghost" onClick={() => reorder(k, k + 1)} disabled={k === items.length - 1} aria-label="Move down"><ArrowDown aria-hidden="true" /></button>
                <button className="btn small icon ghost" onClick={() => remove(s)} aria-label="Remove from deck"><X aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      </fieldset>
    </>
  )
}
