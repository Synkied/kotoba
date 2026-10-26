import { Play, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type WordRow } from '../lib/api'
import { Furigana } from '../components/Furigana'
import { SentenceText } from '../components/SentenceText'
import { IndexNotice, KnownButton, ListenSentence, WordPlates, WordsTabs } from '../components/WordBits'
import { useIndexWait } from '../lib/wordIndex'
import { ErrorNotice, SearchBox, PageHome, Skeleton, useAsync, usePref } from '../components/ui'
import { Button, ButtonLink, ChipButton, EmptyState, Select } from '../components/ds'
import { useOnPractised, usePractise } from '../lib/practise'

const STATUSES = [
  { id: '', name: 'All' }, { id: 'new', name: 'New' }, { id: 'practised', name: 'Practised' },
  { id: 'known', name: 'Known' }, { id: 'trouble', name: 'Keep missing' },
]
const SORTS = [
  { id: 'count', name: 'In the most sentences' }, { id: 'trouble', name: 'Most missed' },
  { id: 'recent', name: 'Newest' }, { id: 'az', name: 'By reading (あ–ん)' },
]
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Every word in the sentences you keep, as the dictionary lists it: how often it comes up,
 *  across how many sources, and how saying it has gone. Filters live in the URL. */
export default function WordsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? '', status = params.get('status') ?? '', sort = params.get('sort') ?? 'count'
  const set = (key: string, value: string) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (value) next.set(key, value); else next.delete(key)
    return next
  }, { replace: true })
  // more is shown on asking; another search starts again at 100
  const shown = [q, status, sort].join('\n')
  const [more, setMore] = useState({ for: shown, limit: 100 })
  const limit = more.for === shown ? more.limit : 100
  const setLimit = (f: (n: number) => number) => setMore({ for: shown, limit: f(limit) })
  const { data, error, loading, reload, set: setData } = useAsync(() => api.words({ q, status, sort, limit }), [q, status, sort, limit])
  useIndexWait(data, reload)
  const filtered = q || status
  const marked = (w: WordRow, known: boolean) => setData((d) => ({
    ...d, results: d.results.map((x) => x.id === w.id ? { ...x, status: known ? 'known' : x.status === 'known' ? 'new' : x.status } : x),
  }))

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/words">Words</PageHome> <span className="meta num">{data ? plural(data.count, 'word') : ''}</span></h1>
        <span className="grow" />
        <div className="search"><SearchBox value={q} onChange={(v) => set('q', v)} placeholder="Look up a word, kanji or reading" /></div>
      </header>
      <WordsTabs />
      <IndexNotice state={data} onChange={reload} />

      <div className="filters" role="group" aria-label="Filters">
        <div className="group">
          <span className="meta">Show</span>
          <div className="chips">
            {STATUSES.map((s) => <ChipButton key={s.id} aria-pressed={status === s.id} onClick={() => set('status', s.id)}>{s.name}</ChipButton>)}
          </div>
          <span className="grow" />
          <Select className="chip-select" aria-label="Order" value={sort} onChange={(e) => set('sort', e.target.value === 'count' ? '' : e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {filtered && <Button variant="ghost" size="small" onClick={() => setParams({}, { replace: true })}><X aria-hidden="true" />Clear filters</Button>}
        </div>
      </div>

      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        loading && !data ? <Skeleton /> :
        !data?.results.length ? (
          <EmptyState>
            <h2>{filtered ? 'No words match' : data?.pending ? 'Finding your words…' : 'No words yet'}</h2>
            <p>{status === 'trouble' ? 'Words you miss twice or more in your latest attempts show up here. Keep practising.'
              : filtered ? 'Try another spelling or reading: “toshokan” finds 図書館, and a single kanji finds every word with it.'
              : 'Words come from the sentences you keep: collect something, then keep it from the inbox.'}</p>
            {!filtered && !data?.pending && <ButtonLink variant="primary" to="/inbox">Go to the inbox</ButtonLink>}
          </EmptyState>
        ) : <ul className="rows word-rows">
          {data.results.map((w) => <li key={w.id} className="row word-row">
            <Link to={`/words/${w.id}`} className="word-row-head" lang="ja">
              <span className="word-row-lemma">{w.lemma}</span>
              {(w.reading && w.reading !== w.lemma || w.romaji) && <span className="word-row-reading">
                {w.reading && w.reading !== w.lemma && <span>{w.reading}</span>}
                {w.romaji && <span className="word-romaji" lang="ja-Latn">{w.romaji}</span>}
              </span>}
            </Link>
            <span className="meta word-row-meta">
              <span className="num">{plural(w.sentences ?? 0, 'sentence')}{(w.sources ?? 0) > 1 && ` · ${w.sources} sources`}</span>
              <WordPlates w={w} />
            </span>
            <div className="acts"><KnownButton small w={w} onChange={(k) => marked(w, k)} /></div>
          </li>)}
        </ul>}
      {data && data.results.length < data.count && <Button disabled={loading} onClick={() => setLimit((n) => n + 200)}>{loading ? 'Loading…' : 'Load more words'}</Button>}
    </>
  )
}

/** Sentences you're one new word away from: you know, or have practised, every other word in
 *  them. The new word that comes up most in your sentences leads. */
export function NextSentencesPage() {
  const { data, error, loading, reload } = useAsync(() => api.nextSentences(), [])
  const practise = usePractise()
  useOnPractised(reload)
  useIndexWait(data, reload)
  const [furigana] = usePref('furigana', true)
  const ids = data?.results.map((r) => r.sentence.id) ?? []
  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/words/next">Next sentences</PageHome> {data && <span className="meta num">{data.results.length}</span>}</h1>
        <span className="grow" />
        {ids.length > 0 && <ButtonLink variant="primary" {...practise.link({ ids })}><Play aria-hidden="true" />Practise these</ButtonLink>}
      </header>
      <WordsTabs />
      <IndexNotice state={data} onChange={reload} />
      <p className="meta">Each of these has one word you haven’t met yet; you know or have practised the rest. Say them, or mark the words you already know.</p>
      {error ? <ErrorNotice error={error} action={<Button size="small" onClick={reload}>Try again</Button>} /> :
        loading && !data ? <Skeleton /> :
        !data?.results.length ? (
          <EmptyState>
            <h2>Nothing one word away yet</h2>
            <p>Practise some sentences, or mark the words you already know on the Words tab. Sentences where everything but one word is familiar then show up here.</p>
            <ButtonLink to="/words?status=new">See your new words</ButtonLink>
          </EmptyState>
        ) : <ul className="rows">
          {data.results.map(({ sentence: s, word: w, sentences, spans }) => {
            return <li key={s.id} className="row">
              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} marks={spans} /></SentenceText>
                <span className="meta">
                  New: <Link to={`/words/${w.id}`} lang="ja"><b>{w.lemma}</b></Link>{w.reading && w.reading !== w.lemma && <span lang="ja"> {w.reading}</span>}
                  {' '}· in {plural(sentences, 'sentence')} · <Link to={`/sources/${s.source}`}>{s.source_title || 'Untitled'}</Link>
                </span>
              </div>
              <div className="acts">
                <ListenSentence s={s} />
                <ButtonLink variant="ghost" size="small" to={`/sentences/${s.id}`}>Details</ButtonLink>
                <ButtonLink variant="ghost" size="small" {...practise.link({ sentence: s.id })}><Play aria-hidden="true" />Practise</ButtonLink>
                <KnownButton small w={w} onChange={reload} />
              </div>
            </li>
          })}
        </ul>}
    </>
  )
}
