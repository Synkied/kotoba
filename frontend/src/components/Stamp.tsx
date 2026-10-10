import type { Stamp as StampT } from '../lib/api'

const rot = (n: number) => `${((n * 37) % 15) - 9}deg`

/** The Japanese school grades double as the stamp's ink: 秀 gold, 優 green, 良 indigo, 可 red. */
const tier = (overall: number) =>
  overall >= 90 ? { key: 'shu', mark: '秀' } : overall >= 75 ? { key: 'yu', mark: '優' } : overall >= 50 ? { key: 'ryo', mark: '良' } : { key: 'ka', mark: '可' }

/** A score stamp, inked by grade. Attempts are never removed; they pile up on the sentence. */
export function Stamp({ s, big, land }: { s: Pick<StampT, 'id' | 'overall' | 'accuracy' | 'clarity' | 'fluency'>; big?: boolean; land?: boolean }) {
  const label = `Score ${s.overall}: accuracy ${s.accuracy}, clarity ${s.clarity}, fluency ${s.fluency}`
  const t = tier(s.overall)
  return (
    <span className={`stamp ${t.key}` + (big ? ' big' : '') + (land ? ' land' : '') + (s.overall < 50 && !big ? ' faint' : '')}
      style={{ ['--rot' as string]: rot(s.id) }} title={label} aria-label={label} role="img">
      {big && <b className="stamp-mark" aria-hidden="true" lang="ja">{t.mark}</b>}
      {s.overall}
      {big && <small aria-hidden="true">SCORE</small>}
      {land && <i className="stamp-splat" aria-hidden="true" />}
      {land && big && t.key === 'shu' && <i className="stamp-glint" aria-hidden="true" />}
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
