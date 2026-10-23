import { Inbox, Library as LibraryIcon, Layers, RotateCcw, Plus, Puzzle, ScrollText, Languages, Search as SearchIcon, NotebookPen, UserRound } from 'lucide-react'
import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { api, SIGNED_OUT, type Account, type AccountState, type Stats } from './lib/api'
import { useTrail } from './lib/trail'
import { ErrorNotice, ToastHost } from './components/ui'
import { SelectionLookup } from './components/WordLookup'
import InboxPage from './pages/Inbox'
import SourcesPage from './pages/Library'
import SourcePage from './pages/Source'
import SentencePage from './pages/Sentence'
import DecksPage from './pages/Decks'
import DeckPage from './pages/Deck'
import PracticePage from './pages/Practice'
import ReviewPage from './pages/Review'
import CollectPage from './pages/Collect'
import AddonsPage from './pages/Addons'
import RecordingsPage from './pages/Recordings'
import CleanupPage from './pages/Cleanup'
import LibraryPage from './pages/Lessons'
import LessonPage from './pages/Lesson'
import TranscriptionsPage from './pages/Transcriptions'
import SentencesPage from './pages/Sentences'
import WordsPage, { NextSentencesPage } from './pages/Words'
import WordPage from './pages/Word'
import DictPage from './pages/Dict'
import SearchPage, { GlobalSearch } from './pages/Search'
import DesignPage from './pages/Design'
import AccountPage, { SignInPage } from './pages/Account'
import { Button, EmptyState, buttonClass } from './components/ds'

type Section = { to: string; name: string; ja: string; short?: string; key: string; icon: typeof Inbox; count?: (s: Stats) => number; hot?: boolean }
const SECTIONS: Section[] = [
  { to: '/inbox', name: 'Inbox', ja: '受信', key: 'inbox', icon: Inbox, count: (s) => s.inbox },
  { to: '/library', name: 'Library', ja: '資料', key: 'library', icon: LibraryIcon, count: (s) => s.lessons },
  { to: '/words', name: 'Words', ja: '単語', key: 'words', icon: Languages },
  { to: '/decks', name: 'Decks', ja: 'デッキ', key: 'decks', icon: Layers },
  { to: '/review', name: 'Review', ja: '復習', key: 'review', icon: RotateCcw, count: (s) => s.due, hot: true },
  { to: '/sources', name: 'Sources', ja: '素材', key: 'sources', icon: ScrollText },
  { to: '/notes', name: 'Notes', ja: 'ノート', key: 'notes', icon: NotebookPen },
  { to: '/collect', name: 'Collect', ja: '収集', key: 'collect', icon: Plus },
]
const NotesPage = lazy(() => import('./pages/Notes'))

const StatsCtx = createContext<{ stats: Stats | null; refresh: () => void }>({ stats: null, refresh: () => {} })
export const useStats = () => useContext(StatsCtx)

/** Recordings and the transcription queue moved into Sources: old links still land. */
function Moved({ to }: { to: string }) {
  const loc = useLocation()
  return <Navigate to={to + loc.search} replace />
}
function ToCleanup() {
  return <Navigate to={`/sources/${useParams().id}/cleanup`} replace />
}

/** Lessons moved into the library: old links keep their folder or archive view. */
function ToLibrary() {
  const loc = useLocation()
  return <Navigate to={'/library' + loc.search} replace />
}

function sectionFor(path: string) {
  if (path.startsWith('/practice')) return 'practice'
  if (path.startsWith('/sentences')) return 'sources'
  if (/^\/sources\/\d+\/cleanup/.test(path)) return 'recordings'
  if (path.startsWith('/lessons')) return 'library'
  if (path.startsWith('/addons') || path.startsWith('/account')) return 'collect'
  return SECTIONS.find((s) => path.startsWith(s.to))?.key ?? 'collect'
}

function Shell({ account }: { account: Account }) {
  const loc = useLocation()
  useTrail()
  const [stats, setStats] = useState<Stats | null>(null)
  const refresh = () => { api.stats().then(setStats, () => {}) }
  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 30000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(refresh, [loc.pathname])
  const section = sectionFor(loc.pathname)
  useEffect(() => {
    document.title = `kotoba · ${section === 'practice' ? 'Practice' : loc.pathname.startsWith('/addons') ? 'Add-ons' : loc.pathname.startsWith('/account') ? 'Account' : loc.pathname.startsWith('/search') ? 'Search' : loc.pathname.startsWith('/design') ? 'Design system' : section.charAt(0).toUpperCase() + section.slice(1)}`
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [loc.pathname, section])

  return (
    <StatsCtx.Provider value={{ stats, refresh }}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <aside className="rail" aria-label="kotoba">
          <NavLink to="/inbox" className="brand" aria-label="kotoba home">
            <span lang="ja" aria-hidden="true">言葉</span>
            <small aria-hidden="true">KOTOBA</small>
          </NavLink>
          <GlobalSearch />
          <nav aria-label="Sections">
            {SECTIONS.map((s) => {
              const n = stats && s.count ? s.count(stats) : 0
              return (
                <Link key={s.to} to={s.to} aria-current={s.key === section ? 'page' : undefined}>
                  <span lang="ja" aria-hidden="true">{s.ja}</span>
                  <small>{s.name}</small>
                  {n > 0 && <span className={'count' + (s.hot ? ' hot' : '')} aria-label={`${n} ${s.hot ? 'due' : 'waiting'}`}>{n}</span>}
                </Link>
              )
            })}
          </nav>
          <div className="foot">
            <NavLink to="/addons"><Puzzle size={14} aria-hidden="true" />Add-ons</NavLink>
            <NavLink to="/account"><UserRound size={14} aria-hidden="true" />{account.username}</NavLink>
            {stats && <span className="meta">{stats.sentences} sentences · {stats.attempts_today} tries today</span>}
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="page">
          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/sources/recordings" element={<RecordingsPage />} />
            <Route path="/sources/sentences" element={<SentencesPage />} />
            <Route path="/sources/queue" element={<TranscriptionsPage />} />
            <Route path="/sources/:id/cleanup" element={<CleanupPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/words" element={<WordsPage />} />
            <Route path="/words/next" element={<NextSentencesPage />} />
            <Route path="/words/:id" element={<WordPage />} />
            <Route path="/dict/:key" element={<DictPage />} />
            <Route path="/sentences/:id" element={<SentencePage />} />
            <Route path="/sources/:id" element={<SourcePage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/lessons" element={<ToLibrary />} />
            <Route path="/lessons/:id" element={<LessonPage />} />
            <Route path="/listening" element={<Navigate to="/library" replace />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/collect" element={<CollectPage />} />
            <Route path="/notes" element={<Suspense fallback={<p className="meta">Opening notes…</p>}><NotesPage /></Suspense>} />
            <Route path="/recordings" element={<Moved to="/sources/recordings" />} />
            <Route path="/recordings/:id" element={<ToCleanup />} />
            <Route path="/transcriptions" element={<Moved to="/sources/queue" />} />
            <Route path="/transcriptions/all" element={<Moved to="/sources/sentences" />} />
            <Route path="/addons" element={<AddonsPage />} />
            <Route path="/account" element={<AccountPage account={account} />} />
            <Route path="/design" element={<DesignPage />} />
            <Route path="*" element={<EmptyState><h2>Nothing on this page</h2><NavLink className={buttonClass({})} to="/inbox">Go to the inbox</NavLink></EmptyState>} />
          </Routes>
        </main>
        <nav className="tabbar" aria-label="Sections">
          {SECTIONS.map((s) => {
            const n = stats && s.count ? s.count(stats) : 0
            const Icon = s.icon
            return (
              <Link key={s.to} to={s.to} aria-current={s.key === section ? 'page' : undefined}>
                <Icon aria-hidden="true" />{s.short ?? s.name}
                {n > 0 && <span className={'count' + (s.hot ? ' hot' : '')} aria-label={`${n} ${s.hot ? 'due' : 'waiting'}`}>{n}</span>}
              </Link>
            )
          })}
          <Link to="/search" aria-current={loc.pathname === '/search' ? 'page' : undefined}>
            <SearchIcon aria-hidden="true" />Search
          </Link>
        </nav>
      </div>
      <SelectionLookup />
    </StatsCtx.Provider>
  )
}


export default function App() {
  const [state, setState] = useState<AccountState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const load = () => api.account().then((s) => { setState(s); setError(null) }, setError)
  useEffect(() => { load() }, [])
  // a session that ended (signed out elsewhere, a changed password) asks to sign in again
  useEffect(() => {
    const out = () => setState((s) => s && { ...s, user: null })
    window.addEventListener(SIGNED_OUT, out)
    return () => window.removeEventListener(SIGNED_OUT, out)
  }, [])

  let content
  if (error != null) content = <main className="signin"><ErrorNotice error={error} action={<Button size="small" onClick={load}>Try again</Button>} /></main>
  else if (!state) content = null  // a moment, while kotoba says who is signed in
  else if (!state.user) content = <SignInPage signup={state.signup} />
  else content = <Shell account={state.user} />
  return (
    <BrowserRouter>
      <ToastHost>{content}</ToastHost>
    </BrowserRouter>
  )
}
