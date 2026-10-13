import { BookOpen, Layers, Search as SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type SearchResults } from '../lib/api'
import { Furigana } from '../components/Furigana'
import { SentenceText } from '../components/SentenceText'
import { ListenSentence, WordPlates } from '../components/WordBits'
import { ErrorNotice, SearchBox, Skeleton, usePref, PageHome } from '../components/ui'
import { ButtonLink, EmptyState, Plate } from '../components/ds'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const KIND = { capture: 'Capture', audio: 'Audio', video: 'Video', subtitle: 'Subtitles', text: 'Text' } as const

/** The search box on the rail: Enter opens everything that matches. Ctrl/⌘ K finds it from anywhere. */
export function GlobalSearch() {
  const loc = useLocation()
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)
  const onPage = loc.pathname === '/search'
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? (onPage ? new URLSearchParams(loc.search).get('q') ?? '' : '')
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      e.preventDefault()
      // the rail is hidden on phones: the search page has its own box
      if (ref.current?.offsetParent) { ref.current.focus(); ref.current.select() } else nav('/search')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [nav])
  return (
    <form className="rail-search" role="search" onSubmit={(e) => {
      e.preventDefault()
      const q = value.trim()
      setDraft(null)
      nav('/search' + (q ? '?q=' + encodeURIComponent(q) : ''))
    }}>
      <label>
        <span className="sr">Search everything</span>
        <SearchIcon aria-hidden="true" />
        <input ref={ref} type="search" value={value} placeholder="Search everything" onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!value) setDraft(null) }} />
        <kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
      </label>
    </form>
  )
}

/** Everything that matches, a few of each: words (by spelling, reading or meaning), sentences
 *  (by text, reading or translation), sources, lessons and decks. The query lives in the URL. */
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [furigana] = usePref('furigana', true)
  const [state, setState] = useState<{ q: string; data?: SearchResults; error?: unknown }>({ q: '' })
  useEffect(() => {
    if (!q.trim()) return
    const ctl = new AbortController()
    const t = window.setTimeout(() => {
      api.search(q, ctl.signal).then((data) => setState({ q, data }), (error) => { if (!ctl.signal.aborted) setState({ q, error }) })
    }, 200)
    return () => { ctl.abort(); window.clearTimeout(t) }
  }, [q])
  const data = q.trim() ? state.data : undefined
  const c = data?.counts
  const total = c ? c.words + c.sentences + c.sources + c.lessons + c.decks : 0
  const enc = encodeURIComponent(q.trim())

  return (
    <>
      <header className="page-head">
        <h1><PageHome to="/search">Search</PageHome> {data && q.trim() && <span className="meta num">{plural(total, 'result')}</span>}</h1>
        <span className="grow" />
        <div className="search search-wide">
          <SearchBox value={q} onChange={(v) => setParams(v ? { q: v } : {}, { replace: true })} placeholder="A word, reading, meaning or anything you noted" />
        </div>
      </header>

      {!q.trim() ? <EmptyState>
        <h2>Search everything you’ve collected</h2>
        <p>Words, sentences, sources, lessons and decks at once. Type it in Japanese, in romaji (<i>toshokan</i> finds 図書館) or by meaning (<i>library</i> finds it too). A single kanji finds every word with it.</p>
      </EmptyState>
      : state.error != null && state.q === q ? <ErrorNotice error={state.error} />
      : !data ? <Skeleton rows={4} />
      : total === 0 ? <EmptyState>
        <h2>Nothing matches “{q.trim()}”</h2>
        <p>Try another spelling, its reading in kana or romaji, or what it means in English.</p>
      </EmptyState>
      : <div className={'search-results' + (state.q !== q ? ' pending' : '')}>
        {data.words.length > 0 && <Group title="Words" count={c!.words} all={`/words?q=${enc}`}>
          <ul className="search-words">{data.words.map((w) => <li key={w.id}>
            <Link to={`/words/${w.id}`} className="search-word">
              <b lang="ja">{w.lemma}</b>
              {w.reading && w.reading !== w.lemma && <span lang="ja">{w.reading}</span>}
              {w.meaning && <span className="search-word-meaning">{w.meaning}</span>}
              <span className="meta num">{plural(w.sentences ?? 0, 'sentence')} <WordPlates w={w} /></span>
            </Link>
          </li>)}</ul>
        </Group>}
        {data.sentences.length > 0 && <Group title="Sentences" count={c!.sentences} all={`/sources/sentences?q=${enc}`}>
          <ul className="rows">{data.sentences.map((s) => <li key={s.id} className="row row-simple">
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <SentenceText><Furigana text={s.text} pairs={s.furigana} show={furigana} /></SentenceText>
              <span className="meta"><Link to={`/sources/${s.source}`}>{s.source_title || 'Untitled'}</Link></span>
            </div>
            <div className="acts">
              <ListenSentence s={s} />
              <ButtonLink variant="ghost" size="small" to={`/sentences/${s.id}`}>Details</ButtonLink>
            </div>
          </li>)}</ul>
        </Group>}
        {data.sources.length > 0 && <Group title="Sources" count={c!.sources}>
          <ul className="search-list">{data.sources.map((s) => <li key={s.id}>
            <Link to={`/sources/${s.id}`} lang={s.title === 'Untitled' ? undefined : 'ja'}>{s.title}</Link>
            <span className="meta num">{KIND[s.kind]} · {plural(s.sentences, 'sentence')}</span>
            {s.status !== 'kept' && <Plate tone="hollow">{s.status === 'inbox' ? 'inbox' : 'archived'}</Plate>}
          </li>)}</ul>
        </Group>}
        {data.lessons.length > 0 && <Group title="Lessons" count={c!.lessons}>
          <ul className="search-list">{data.lessons.map((l) => <li key={l.id}>
            <BookOpen aria-hidden="true" /><Link to={`/lessons/${l.id}`}>{l.title}</Link>{l.done && <Plate tone="hollow">done</Plate>}
          </li>)}</ul>
        </Group>}
        {data.decks.length > 0 && <Group title="Decks" count={c!.decks}>
          <ul className="search-list">{data.decks.map((d) => <li key={d.id}>
            <Layers aria-hidden="true" /><Link to={`/decks/${d.id}`}>{d.name}</Link><span className="meta num">{plural(d.size, 'sentence')}</span>
          </li>)}</ul>
        </Group>}
      </div>}
    </>
  )
}

function Group({ title, count, all, children }: { title: string; count: number; all?: string; children: React.ReactNode }) {
  return (
    <section className="search-group" aria-label={title}>
      <div className="day-head"><h2>{title}</h2><span className="meta num">{count}</span>
        <span className="grow" />{all && count > 0 && <Link to={all}>See all {count}</Link>}</div>
      {children}
    </section>
  )
}
