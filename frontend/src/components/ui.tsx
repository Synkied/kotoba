import { Search as SearchIcon, AlertTriangle } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <label className="search">
      <span className="sr">Search</span>
      <SearchIcon aria-hidden="true" />
      <input ref={ref} className="input" type="search" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (onChange(''), ref.current?.blur())} />
      {!value && <span className="kbd" aria-hidden="true">/</span>}
    </label>
  )
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <i key={i} />)}</div>
}

export function ErrorNotice({ error, action }: { error: unknown; action?: ReactNode }) {
  return (
    <div className="notice error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div style={{ display: 'grid', gap: 8 }}><span>{String((error as Error)?.message ?? error)}</span>{action}</div>
    </div>
  )
}

type Toast = { text: string; undo?: () => void }
const ToastCtx = createContext<(t: Toast) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((t: Toast) => {
    setToast(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), t.undo ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite">
        {toast && (
          <div className="toast" role="status">
            {toast.text}
            {toast.undo && <button className="btn small" onClick={() => { toast.undo?.(); setToast(null) }}>Undo</button>}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  )
}

export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem('kotoba.' + key); return s === null ? initial : JSON.parse(s) } catch { return initial }
  })
  const set = useCallback((nv: T) => {
    setV(nv)
    try { localStorage.setItem('kotoba.' + key, JSON.stringify(nv)) } catch { /* private mode */ }
  }, [key])
  return [v, set]
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true }))
    fn().then((data) => live && setState({ data, loading: false }), (error) => live && setState({ error, loading: false }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1), set: (data: T) => setState({ data, loading: false }) }
}

export const dayLabel = (iso: string) => {
  const d = new Date(iso), today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return { date, rel: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : '' }
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
