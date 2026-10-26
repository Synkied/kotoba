import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** What a practice run goes through: a source, one sentence, a deck, or a hand-picked list. */
export type PractiseSpec = { source: number } | { sentence: number } | { deck: number } | { ids: number[] }

/** Sent when a practice run over a page is put away, so the page can show the new stamps. */
export const PRACTISED = 'kotoba:practised'

/** The ?practise= value: source:12, sentence:5, deck:3 or ids:1,2,3. */
export function specParam(p: PractiseSpec) {
  if ('ids' in p) return 'ids:' + p.ids.join(',')
  if ('source' in p) return `source:${p.source}`
  if ('sentence' in p) return `sentence:${p.sentence}`
  return `deck:${p.deck}`
}

export function parseSpec(v: string | null): PractiseSpec | null {
  const m = v?.match(/^(source|sentence|deck|ids):([\d,]+)$/)
  if (!m) return null
  if (m[1] === 'ids') { const ids = m[2].split(',').map(Number).filter(Boolean); return ids.length ? { ids } : null }
  const n = Number(m[2])
  if (!n) return null
  return m[1] === 'source' ? { source: n } : m[1] === 'sentence' ? { sentence: n } : { deck: n }
}

/** Practise buttons open the run over the page they're on (?practise=…), so Back, Esc or Close
 *  puts it away and leaves you where you were. */
export function usePractise() {
  const loc = useLocation()
  const nav = useNavigate()
  const link = (p: PractiseSpec) => {
    const q = new URLSearchParams(loc.search)
    q.set('practise', specParam(p))
    const state = { ...(loc.state && typeof loc.state === 'object' ? loc.state : {}), practise: true }
    return { to: { pathname: loc.pathname, search: '?' + q }, state }
  }
  const open = (p: PractiseSpec) => { const l = link(p); nav(l.to, { state: l.state }) }
  return { link, open }
}

/** Runs fn whenever a practice run over this page is put away. */
export function useOnPractised(fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    const on = () => ref.current()
    window.addEventListener(PRACTISED, on)
    return () => window.removeEventListener(PRACTISED, on)
  }, [])
}
