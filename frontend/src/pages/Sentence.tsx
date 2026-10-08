import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { api, type Sentence } from '../lib/api'
import { SentenceText } from '../components/SentenceText'
import { Furigana } from '../components/Furigana'
import { SentenceAudio } from '../components/SentenceAudio'
import { DeckPicker } from '../components/DeckPicker'
import { Stamps } from '../components/Stamp'
import { ErrorNotice, Skeleton, useAsync, useToast } from '../components/ui'
import { ReadingAids, Translation, useAids, useLanguage } from '../components/ReadingAids'

export default function SentencePage() {
  const id = Number(useParams().id)
  return <Detail key={id} id={id} />
}
function Detail({ id }: { id: number }) {
  const detail = useAsync(async () => { const sentence = await api.sentence(id); return { sentence, source: await api.source(sentence.source) } }, [id])
  const aids = useAids()
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const toast = useToast()
  if (detail.error) return <ErrorNotice error={detail.error} action={<Link to="/library">Open library</Link>} />
  if (!detail.data || detail.loading) return <Skeleton rows={3} />
  const { sentence: s, source } = detail.data
  const index = source.sentences.findIndex(x => x.id === s.id)
  return <div className="sentence-detail">
    <header className="page-head sentence-head"><div><h1>Sentence {index + 1}</h1>
      <p className="meta">From <Link to={`/sources/${source.id}`}>{source.title || s.source_title}</Link></p></div>
    </header>
    <div className="sentence-layout"><div className="sentence-main">
      <section className="sentence-reading" aria-label="Sentence text"><SentenceText><Furigana text={s.text} pairs={s.furigana} show={aids.furigana} />{aids.roman && s.roman && <span className="roman">{s.roman.split('\t')[0]}</span>}
        {aids.translation && <Translation s={s} onTranslated={updated => detail.set({ source, sentence: updated })} />}</SentenceText>
      <ReadingAids aids={aids} roman={!!s.roman} />
      <div className="sentence-actions">
      <Link className="btn primary" to={`/practice?sentence=${s.id}`}>Practise sentence</Link>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); toast({ text: 'Sentence link copied' }) } catch { toast({ text: 'Copy the link from your address bar' }) } }}>Copy link</button>
      <DeckPicker sentenceIds={() => [s.id]} onDone={detail.reload} />
      </div></section>
      {source.media ? <SentenceAudio sentence={s} source={source} /> : <p className="meta">This sentence has no source audio.</p>}
      {s.image && <img className="sentence-image" src={s.image} alt="Original source capture" />}
      <ReadingEditor sentence={s} onSaved={updated => detail.set({ source, sentence: updated })} />
      <TranslationEditor key={s.id} sentence={s} onSaved={updated => detail.set({ source, sentence: updated })} />
      <section className="sentence-section"><h2>Notes</h2><form className="sentence-notes" onSubmit={async e => {
        e.preventDefault(); setSaving(true); setSaveError(null)
        try { const updated = await api.updateSentence(s.id, { note: note ?? s.note }); detail.set({ source, sentence: updated }); setNote(null); toast({ text: 'Note saved' }) } catch (err) { setSaveError(err) } finally { setSaving(false) }
      }}><label><span className="sr">Sentence notes</span><textarea className="input" rows={4} value={note ?? s.note} onChange={e => setNote(e.target.value)} placeholder="Meaning, vocabulary, or something to remember…" /></label>
        {saveError != null && <ErrorNotice error={saveError} />}<button className="btn primary" disabled={saving || note === null}>{saving ? 'Saving…' : 'Save note'}</button>
      </form></section>
    </div><aside className="sentence-aside">
      <section className="sentence-section"><h2>In this source</h2><nav aria-label="Nearby sentences" className="sentence-context">{source.sentences.slice(Math.max(0, index - 1), index + 2).map(x => <div key={x.id} className="sentence-context-item"><span className="meta">Sentence {source.sentences.indexOf(x) + 1}</span><span lang="ja"><Link to={`/sentences/${x.id}`} aria-current={x.id === s.id ? 'page' : undefined}>{x.text}</Link></span></div>)}</nav><Link to={`/sources/${source.id}`}>All {source.sentences.length} sentences</Link></section>
      <section className="sentence-section"><h2>Decks</h2>{s.decks.length ? <div className="chips">{s.decks.map(d => <Link className="chip" key={d.id} to={`/decks/${d.id}`}>{d.name}</Link>)}</div> : <p className="meta">No decks yet. Use “Add to deck” above.</p>}</section>
      <section className="sentence-section"><h2>Practice history</h2><Stamps stamps={s.stamps} max={6} />{!s.stamps.length && <p className="meta">No attempts yet.</p>}<p className="meta">{s.reps} reviews · Best {s.best ?? '—'} · Latest {s.last ?? '—'}</p>{s.due && <p className="meta">Next review: {new Date(s.due).toLocaleString()}</p>}</section>
    </aside></div>
  </div>
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
  return <section className="sentence-section"><div className="sentence-section-head"><h2>Readings</h2>
    {draft === null && <button className="btn" onClick={() => setDraft(s.furigana.map(p => [...p]))}>Edit readings</button>}
  </div><p className="meta">{s.reading_overrides.length ? 'Your saved readings are used for this sentence.' : 'Readings are generated automatically. Correct ambiguous words here.'}</p>
  {draft !== null && <form className="sentence-notes" onSubmit={e => { e.preventDefault(); void save(draft) }}>
    <div className="reading-fields">{draft.map(([surface, reading], i) => <label key={i}><span lang="ja">{surface}</span><input className="input" lang="ja" value={reading} required maxLength={100} onChange={e => setDraft(draft.map((p, j) => j === i ? [p[0], e.target.value] : p))} /></label>)}</div>
    <div className="btn-row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save readings'}</button><button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
  </form>}
  {s.reading_overrides.length > 0 && <button className="btn ghost" disabled={busy} onClick={() => void save([])}>Reset to automatic</button>}
  {error != null && <ErrorNotice error={error} />}
  </section>
}

/** The translation in the chosen language: fix it by hand, or ask for a fresh one. */
function TranslationEditor({ sentence: s, onSaved }: { sentence: Sentence; onSaved: (s: Sentence) => void }) {
  const lang = useLanguage()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'translate' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const toast = useToast()
  if (!lang) return null
  const saved = s.translations[lang.to] ?? ''
  const run = async (what: 'save' | 'translate') => {
    setBusy(what); setError(null)
    try {
      const updated = what === 'save'
        ? await api.updateSentence(s.id, { translations: { ...s.translations, [lang.to]: draft ?? saved } })
        : await api.translate(s.id, true)
      onSaved(updated); setDraft(null)
      toast({ text: what === 'save' ? 'Translation saved' : 'Translated again' })
    } catch (err) { setError(err) } finally { setBusy(null) }
  }
  return <section className="sentence-section"><h2>{lang.name}</h2>
    <form className="sentence-notes" onSubmit={e => { e.preventDefault(); void run('save') }}>
      <label><span className="sr">{lang.name} translation</span>
        <textarea className="input" rows={2} lang={lang.to} value={draft ?? saved} onChange={e => setDraft(e.target.value)}
          placeholder={`What it means in ${lang.name}. Write your own, or ask the translator.`} /></label>
      {error != null && <ErrorNotice error={error} action={<Link to="/addons">Set up translation</Link>} />}
      <div className="btn-row">
        <button className="btn primary" disabled={busy !== null || draft === null || draft === saved}>{busy === 'save' ? 'Saving…' : 'Save translation'}</button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void run('translate')} aria-busy={busy === 'translate'}>
          {busy === 'translate' ? 'Translating…' : saved ? 'Translate again' : 'Translate'}</button>
      </div>
    </form>
  </section>
}
