import type { Stamp as StampT } from '../lib/api'

const rot = (n: number) => `${((n * 37) % 15) - 9}deg`

/** A red score stamp. Attempts are never removed; they pile up on the sentence. */
export function Stamp({ s, big, land }: { s: Pick<StampT, 'id' | 'overall' | 'accuracy' | 'clarity' | 'fluency'>; big?: boolean; land?: boolean }) {
  const label = `Score ${s.overall}: accuracy ${s.accuracy}, clarity ${s.clarity}, fluency ${s.fluency}`
  return (
    <span className={'stamp' + (big ? ' big' : '') + (land ? ' land' : '') + (s.overall < 50 && !big ? ' faint' : '')}
      style={{ ['--rot' as string]: rot(s.id) }} title={label} aria-label={label} role="img">
      {s.overall}
      {big && <small aria-hidden="true">SCORE</small>}
    </span>
  )
}

export function Stamps({ stamps, max = 5 }: { stamps: StampT[]; max?: number }) {
  if (!stamps.length) return <span className="meta">Not practised</span>
  return (
    <span className="stamps" aria-label={`${stamps.length} attempts`}>
      {stamps.slice(0, max).map((s) => <Stamp key={s.id} s={s} />)}
    </span>
  )
}
