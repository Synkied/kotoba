import { useEffect, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// the page before the current one, so detail pages can go back to where the reader came from
let current = ''
let previous = ''
const here = () => window.location.pathname + window.location.search

/** Call once in the shell: follows every in-app navigation. */
export function useTrail() {
  const loc = useLocation()
  useEffect(() => {
    const at = loc.pathname + loc.search
    if (at !== current) { previous = current; current = at }
  }, [loc.pathname, loc.search])
}

/** The in-app page the reader was on before this one, if any. */
const lastPage = () => (current && current !== here() ? current : previous) || null

const store = (key: string, value?: string) => {
  try {
    if (value === undefined) return sessionStorage.getItem(key)
    sessionStorage.setItem(key, value)
  } catch { /* storage unavailable: the fallback still works */ }
  return null
}

/**
 * Where a detail page's Back button leads: the page it was opened from, kept across trips to its
 * own sub-pages (`isChild`) or via the browser's back button so Back doesn't bounce there.
 */
export function useBackTo(key: string, isChild: (path: string) => boolean): string | null {
  const pop = useNavigationType() === 'POP'
  const [from] = useState(() => {
    const last = lastPage()
    const kept = store(`back:${key}`)
    if (last && !(kept && (pop || isChild(last)))) { store(`back:${key}`, last); return last }
    return kept
  })
  return from
}
