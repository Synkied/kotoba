import { api, byFolder } from '../lib/api'
import { ErrorNotice, useAction, useAsync, useToast } from './ui'

/** A standard select: "Add to deck…", existing decks, then "New deck…". */
export function DeckPicker({ sentenceIds, onDone, small }: { sentenceIds: () => Promise<number[]> | number[]; onDone?: () => void; small?: boolean }) {
  const list = useAsync(() => api.decks(), [])
  const decks = list.data?.results ?? []
  const toast = useToast()
  const action = useAction()
  const choose = async (value: string) => {
    if (!value) return
    await action.run(async () => {
    const ids = await sentenceIds()
    if (!ids.length) { toast({ text: 'Nothing to add: these have no sentences yet.' }); return }
    let deckId = Number(value), name = decks.find((d) => d.id === deckId)?.name
    if (value === 'new') {
      const n = window.prompt('Name the new deck', '')?.trim()
      if (!n) return
      const d = await api.createDeck(n)
      list.set({ count: decks.length + 1, results: [d, ...decks] }); deckId = d.id; name = d.name
    }
    await api.addToDeck(deckId, ids)
    list.reload()
    toast({ text: `Added ${ids.length} sentence${ids.length > 1 ? 's' : ''} to ${name}` })
    onDone?.()
    })
  }
  return (
    <div className="deck-picker"><label>
      <span className="sr">Add to deck</span>
      <select className="select" style={{ height: small ? 'var(--control-h-s)' : 'var(--control-h)', minHeight: 0, paddingBlock: 0, width: 'auto', fontSize: 'var(--t-s)' }}
        disabled={action.busy || list.loading || !!list.error} aria-busy={action.busy || list.loading} value="" onChange={(e) => choose(e.target.value)}>
        <option value="">{list.loading ? 'Loading decks…' : 'Add to deck…'}</option>
        {byFolder(decks).map(([folder, ds], _, groups) => {
          const options = ds.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.size})</option>)
          return groups.length > 1 ? <optgroup key={folder} label={folder || 'No folder'}>{options}</optgroup> : options
        })}
        <option value="new">New deck…</option>
      </select>
    </label>{list.error != null && <ErrorNotice error={list.error} action={<button className="btn small" onClick={list.reload}>Retry loading decks</button>} />}{action.error != null && <ErrorNotice error={action.error} />}</div>
  )
}
