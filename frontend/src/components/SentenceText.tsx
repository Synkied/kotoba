import type { ReactNode } from 'react'

/** Compact reading text for browsing; expressive balloons belong to practice. */
export function SentenceText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`sentence-text ${className}`} lang="ja">{children}</div>
}
