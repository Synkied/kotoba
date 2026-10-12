import { useEffect } from 'react'
import type { WordIndex } from './api'

/** While the word index is still reading sentences (or the dictionary is on its way), look again until it's done. */
export function useIndexWait(state: WordIndex | undefined, reload: () => void) {
  const waiting = (state?.pending ?? 0) > 0 || state?.dictionary === 'downloading'
  useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(reload, 3000)
    return () => window.clearTimeout(t)
  }, [waiting, state, reload])
}
