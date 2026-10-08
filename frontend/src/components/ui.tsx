import { Search as SearchIcon, AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { onVoiceLoading, voiceLoadingNow } from '../lib/audio'

export function shortcutBlocked(e: KeyboardEvent) {
  return e.defaultPrevented || e.isComposing || e.repeat || e.metaKey || e.ctrlKey || e.altKey ||
    (e.target instanceof Element && !!e.target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"]'))
}

export function useAction() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await fn() } catch (err) { setError(err) }
    finally { lock.current = false; setBusy(false) }
  }, [])
  const clearError = useCallback(() => setError(null), [])
  return { busy, error, run, clearError }
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !shortcutBlocked(e)) {
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

type Toast = { text: string; undo?: () => void | Promise<void> }
const ToastCtx = createContext<(t: Toast) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const undoAction = useAction()
  const { clearError } = undoAction
  const show = useCallback((t: Toast) => {
    clearError(); setToast(t)
    window.clearTimeout(timer.current)
    if (!t.undo) timer.current = window.setTimeout(() => setToast(null), 5000)
  }, [clearError])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const voiceLoading = useVoiceLoading()
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite">
        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}{undoAction.error != null && <span role="alert" className="toast-error">Undo failed. Check your connection and try Undo again.</span>}</span>
            {toast.undo && <button className="btn small" disabled={undoAction.busy} onClick={() => undoAction.run(async () => { await toast.undo?.(); setToast(null) })}>Undo</button>}
            <button className="btn small icon" aria-label="Dismiss notification" onClick={() => setToast(null)}><X aria-hidden="true" /></button>
          </div>
        )}
        {!toast && voiceLoading && (
          <div className="toast" role="status">
            <LoaderCircle className="loading-spinner" aria-hidden="true" />
            <span>Loading the Kokoro voice. The first time downloads it, so this can take a minute.</span>
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  )
}

/** True while a voice model loads (see speak). */
export const useVoiceLoading = () => useSyncExternalStore(onVoiceLoading, voiceLoadingNow)

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
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const set = useCallback((data: T) => setState({ data, loading: false }), [])
  return { ...state, reload, set }
}

export const dayLabel = (iso: string) => {
  const d = new Date(iso), today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return { date, rel: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : '' }
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
