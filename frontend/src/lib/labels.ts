export const MAX_LABELS = 3

/** Labels are typed as one line: split on commas (also 、 and full-width ，), trim, drop
 *  empties and case-insensitive repeats. Mirrors clean_labels on the server. */
export function parseLabels(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[,、，､]/)) {
    const label = part.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (label && !seen.has(label.toLowerCase())) { seen.add(label.toLowerCase()); out.push(label) }
  }
  return out
}

/** The labels a source would end up with, or null when that passes the limit. */
export function mergeLabels(existing: string[], add: string[]): string[] | null {
  const have = new Set(existing.map(l => l.toLowerCase()))
  const next = [...existing, ...add.filter(l => !have.has(l.toLowerCase()))]
  return next.length > MAX_LABELS ? null : next
}
