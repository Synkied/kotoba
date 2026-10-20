import type { LucideIcon } from 'lucide-react'
import { dyeIcon, type Dye } from '../lib/dyes'
import { cx } from './ds'

/** A square of dye holding the kind's icon: you know what a row or card is before you read it. */
export function KindTile({ dye, icon, size, className }: { dye: Dye; icon?: LucideIcon; size?: 'small' | 'large'; className?: string }) {
  const Icon = icon ?? dyeIcon[dye]
  return <span className={cx('kind-tile', size, className)} data-dye={dye} aria-hidden="true"><Icon /></span>
}

/** What something holds, one dyed square per kind: "■ PDF  ■ 4 recordings  ■ 1 note". */
export function KindCounts({ parts, className }: { parts: { dye: Dye; text: string }[]; className?: string }) {
  return (
    <span className={cx('kind-counts', className)}>
      {parts.map(p => <span key={p.dye + p.text} className="kind-count" data-dye={p.dye}>{p.text}</span>)}
    </span>
  )
}
