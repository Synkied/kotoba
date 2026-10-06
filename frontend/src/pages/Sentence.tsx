import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { api, type Sentence } from '../lib/api'
import { Balloon } from '../components/Balloon'
import { Furigana } from '../components/Furigana'
import { SentenceAudio } from '../components/SentenceAudio'
import { DeckPicker } from '../components/DeckPicker'
import { Stamps } from '../components/Stamp'
import { ErrorNotice, Skeleton, useAsync, usePref, useToast } from '../components/ui'

export default function SentencePage() {
  const id = Number(useParams().id)
  return <Detail key={id} id={id} />
}
function Detail({ id }: { id: number }) {
  const detail = useAsync(async () => { const sentence = await api.sentence(id); return { sentence, source: await api.source(sentence.source) } }, [id])
  const [furigana, setFurigana] = usePref('furigana', true)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const toast = useToast()
  if (detail.error) return <ErrorNotice error={detail.error} action={<Link to="/library">Open library</Link>} />
  if (!detail.data || detail.loading) return <Skeleton rows={3} />
  const { sentence: s, source } = detail.data
  const index = source.sentences.findIndex(x => x.id === s.id)
  return <>
    <header className="page-head"><h1>Sentence {index + 1}</h1><span className="grow" />
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); toast({ text: 'Sentence link copied' }) } catch { toast({ text: 'Copy the link from your address bar' }) } }}>Copy link</button>
      <DeckPicker sentenceIds={() => [s.id]} onDone={detail.reload} />
      <Link className="btn primary" to={`/practice?sentence=${s.id}`}>Practise sentence</Link>
    </header>
    <p>From <Link to={`/sources/${source.id}`}>{source.title || s.source_title}</Link></p>
    <div className="sentence-layout"><div className="sentence-main">
      <Balloon tail="none"><Furigana text={s.text} pairs={s.furigana} show={furigana} />{s.roman && <span className="roman">{s.roman.split('\t')[0]}</span>}</Balloon>
      <label><input type="checkbox" checked={furigana} onChange={e => setFurigana(e.target.checked)} /> Show furigana</label>
      {source.media ? <SentenceAudio sentence={s} source={source} /> : <p className="meta">This sentence has no source audio.</p>}
      {s.image && <img className="sentence-image" src={s.image} alt="Original source capture" />}
      <ReadingEditor sentence={s} onSaved={updated => detail.set({ source, sentence: updated })} />
      <section><h2>Notes</h2><form className="sentence-notes" onSubmit={async e => {
        e.preventDefault(); setSaving(true); setSaveError(null)
        try { const updated = await api.updateSentence(s.id, { note: note ?? s.note }); detail.set({ source, sentence: updated }); setNote(null); toast({ text: 'Note saved' }) } catch (err) { setSaveError(err) } finally { setSaving(false) }
      }}><label><span className="sr">Sentence notes</span><textarea className="input" rows={4} value={note ?? s.note} onChange={e => setNote(e.target.value)} placeholder="Meaning, vocabulary, or something to remember…" /></label>
        {saveError != null && <ErrorNotice error={saveError} />}<button className="btn primary" disabled={saving || note === null}>{saving ? 'Saving…' : 'Save note'}</button>
      </form></section>
    </div><aside className="sentence-aside">
      <section><h2>In this source</h2><nav aria-label="Nearby sentences" className="sentence-context">{source.sentences.slice(Math.max(0, index - 1), index + 2).map(x => <Link key={x.id} to={`/sentences/${x.id}`} aria-current={x.id === s.id ? 'page' : undefined}><span className="meta">Sentence {source.sentences.indexOf(x) + 1}</span><span lang="ja">{x.text}</span></Link>)}</nav><Link to={`/sources/${source.id}`}>All {source.sentences.length} sentences</Link></section>
      <section><h2>Decks</h2>{s.decks.length ? <div className="chips">{s.decks.map(d => <Link className="chip" key={d.id} to={`/decks/${d.id}`}>{d.name}</Link>)}</div> : <p className="meta">No decks yet. Use “Add to deck” above.</p>}</section>
      <section><h2>Practice history</h2><Stamps stamps={s.stamps} max={6} />{!s.stamps.length && <p className="meta">No attempts yet.</p>}<p className="meta">{s.reps} reviews · Best {s.best ?? '—'} · Latest {s.last ?? '—'}</p>{s.due && <p className="meta">Next review: {new Date(s.due).toLocaleString()}</p>}</section>
    </aside></div>
  </>
}

function ReadingEditor({ sentence: s, onSaved }: { sentence: Sentence; onSaved: (s: Sentence) => void }) {
  const [draft, setDraft] = useState<[string, string][] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const save = async (pairs: [string, string][]) => {
    setBusy(true); setError(null)
    try { onSaved(await api.updateSentence(s.id, { reading_overrides: pairs })); setDraft(null) }
    catch (err) { setError(err) } finally { setBusy(false) }
  }
  if (!s.furigana.length) return null
  return <section><div className="btn-row"><h2>Readings</h2><span className="grow" />
    {draft === null && <button className="btn small" onClick={() => setDraft(s.furigana.map(p => [...p]))}>Edit readings</button>}
  </div><p className="meta">{s.reading_overrides.length ? 'Your saved readings are used for this sentence.' : 'Readings are generated automatically. Correct ambiguous words here.'}</p>
  {draft !== null && <form className="sentence-notes" onSubmit={e => { e.preventDefault(); void save(draft) }}>
    <div className="reading-fields">{draft.map(([surface, reading], i) => <label key={i}><span lang="ja">{surface}</span><input className="input" lang="ja" value={reading} required maxLength={100} onChange={e => setDraft(draft.map((p, j) => j === i ? [p[0], e.target.value] : p))} /></label>)}</div>
    <div className="btn-row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save readings'}</button><button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
  </form>}
  {s.reading_overrides.length > 0 && <button className="btn small ghost" disabled={busy} onClick={() => void save([])}>Reset to automatic</button>}
  {error != null && <ErrorNotice error={error} />}
  </section>
}
