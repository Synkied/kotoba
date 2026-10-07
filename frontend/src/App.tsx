import { Inbox, Library as LibraryIcon, Layers, RotateCcw, Plus, Puzzle, Mic, Headphones } from 'lucide-react'
import { createContext, useContext, useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, type Stats } from './lib/api'
import { ToastHost } from './components/ui'
import InboxPage from './pages/Inbox'
import LibraryPage from './pages/Library'
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
import ListeningPage from './pages/Listening'

type Section = { to: string; name: string; short?: string; stock: string; icon: typeof Inbox; count?: (s: Stats) => number; hot?: boolean }
const SECTIONS: Section[] = [
  { to: '/inbox', name: 'Inbox', stock: 'inbox', icon: Inbox, count: (s) => s.inbox },
  { to: '/library', name: 'Library', stock: 'library', icon: LibraryIcon },
  { to: '/decks', name: 'Decks', stock: 'decks', icon: Layers },
  { to: '/listening', name: 'Listening', short: 'Listen', stock: 'listening', icon: Headphones },
  { to: '/review', name: 'Review', stock: 'review', icon: RotateCcw, count: (s) => s.due, hot: true },
  { to: '/recordings', name: 'Recordings', short: 'Audio', stock: 'recordings', icon: Mic },
  { to: '/collect', name: 'Collect', stock: 'collect', icon: Plus },
]

const StatsCtx = createContext<{ stats: Stats | null; refresh: () => void }>({ stats: null, refresh: () => {} })
export const useStats = () => useContext(StatsCtx)

function stockFor(path: string) {
  if (path.startsWith('/practice')) return 'practice'
  if (path.startsWith('/sources') || path.startsWith('/sentences')) return 'library'
  if (path.startsWith('/addons')) return 'collect'
  return SECTIONS.find((s) => path.startsWith(s.to))?.stock ?? 'collect'
}

function Shell() {
  const loc = useLocation()
  const [stats, setStats] = useState<Stats | null>(null)
  const refresh = () => { api.stats().then(setStats, () => {}) }
  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 30000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(refresh, [loc.pathname])
  const stock = stockFor(loc.pathname)
  useEffect(() => {
    document.title = `kotoba · ${stock === 'practice' ? 'Practice' : stock === 'library' ? 'Library' : loc.pathname.startsWith('/addons') ? 'Add-ons' : stock.charAt(0).toUpperCase() + stock.slice(1)}`
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [loc.pathname, stock])
  useEffect(() => { document.body.style.setProperty('--stock', `var(--stock-${stock})`) }, [stock])

  return (
    <StatsCtx.Provider value={{ stats, refresh }}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <aside className="spine" aria-label="kotoba">
          <NavLink to="/inbox" className="brand" aria-label="kotoba home">
            <span className="mark" lang="ja" aria-hidden="true">言葉</span>
            <span className="word">kotoba<small>your sentences</small></span>
          </NavLink>
          <nav aria-label="Sections">
            {SECTIONS.map((s) => {
              const n = stats && s.count ? s.count(stats) : 0
              return (
                <Link key={s.to} to={s.to} aria-current={s.stock === stock && stock !== 'practice' ? 'page' : undefined} style={{ ['--sw' as string]: `var(--stock-${s.stock})` }}>
                  <span className="swatch" aria-hidden="true" />
                  {s.name}
                  {n > 0 && <span className={'count' + (s.hot ? ' hot' : '')} aria-label={`${n} ${s.hot ? 'due' : 'waiting'}`}>{n}</span>}
                </Link>
              )
            })}
          </nav>
          <div className="foot">
            <NavLink to="/addons"><Puzzle size={14} aria-hidden="true" />Add-ons</NavLink>
            {stats && <span className="meta" style={{ color: 'var(--spine-ink-2)' }}>{stats.sentences} sentences · {stats.attempts_today} tries today</span>}
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="page" style={{ ['--stock' as string]: `var(--stock-${stock})` }}>
          <LinkToSetup />
          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/sentences/:id" element={<SentencePage />} />
            <Route path="/sources/:id" element={<SourcePage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckPage />} />
            <Route path="/listening" element={<ListeningPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/collect" element={<CollectPage />} />
            <Route path="/recordings" element={<RecordingsPage />} />
            <Route path="/recordings/:id" element={<CleanupPage />} />
            <Route path="/addons" element={<AddonsPage />} />
            <Route path="*" element={<div className="empty"><h2>Nothing on this page</h2><NavLink className="btn" to="/inbox">Go to the inbox</NavLink></div>} />
          </Routes>
        </main>
        <nav className="tabbar" aria-label="Sections">
          {SECTIONS.map((s) => {
            const n = stats && s.count ? s.count(stats) : 0
            const Icon = s.icon
            return (
              <Link key={s.to} to={s.to} aria-current={s.stock === stock && stock !== 'practice' ? 'page' : undefined} style={{ ['--sw' as string]: `var(--stock-${s.stock})` }}>
                <Icon aria-hidden="true" />{s.short ?? s.name}
                {n > 0 && <span className={'count' + (s.hot ? ' hot' : '')} aria-label={`${n} ${s.hot ? 'due' : 'waiting'}`}>{n}</span>}
              </Link>
            )
          })}
        </nav>
      </div>
    </StatsCtx.Provider>
  )
}

function LinkToSetup() {
  return <NavLink className="mobile-setup btn small ghost" to="/addons"><Puzzle aria-hidden="true" />Add-ons</NavLink>
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastHost><Shell /></ToastHost>
    </BrowserRouter>
  )
}
