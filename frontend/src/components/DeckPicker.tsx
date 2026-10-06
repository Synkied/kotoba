import { useEffect, useState } from 'react'
import { api, type Deck } from '../lib/api'
import { useToast } from './ui'

/** A standard select: "Add to deck…", existing decks, then "New deck…". */
export function DeckPicker({ sentenceIds, onDone, small }: { sentenceIds: () => Promise<number[]> | number[]; onDone?: () => void; small?: boolean }) {
  const [decks, setDecks] = useState<Deck[]>([])
  const toast = useToast()
  useEffect(() => { api.decks().then((d) => setDecks(d.results), () => {}) }, [])
  const choose = async (value: string) => {
    if (!value) return
    let deckId = Number(value), name = decks.find((d) => d.id === deckId)?.name
    if (value === 'new') {
      const n = window.prompt('Name the new deck', '')?.trim()
      if (!n) return
      const d = await api.createDeck(n)
      setDecks([d, ...decks]); deckId = d.id; name = d.name
    }
    const ids = await sentenceIds()
    if (!ids.length) return toast({ text: 'Nothing to add: these have no sentences yet.' })
    await api.addToDeck(deckId, ids)
    toast({ text: `Added ${ids.length} sentence${ids.length > 1 ? 's' : ''} to ${name}` })
    onDone?.()
  }
  return (
    <label>
      <span className="sr">Add to deck</span>
      <select className="select" style={{ height: small ? 'var(--control-h-s)' : undefined, minHeight: 0, paddingBlock: 0, width: 'auto' }}
        value="" onChange={(e) => choose(e.target.value)}>
        <option value="">Add to deck…</option>
        {decks.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.size})</option>)}
        <option value="new">New deck…</option>
      </select>
    </label>
  )
}
