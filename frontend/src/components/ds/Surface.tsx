import type { ComponentProps, ElementType } from 'react'
import { cx } from './cx'

type As<T extends ElementType> = { as?: T } & Omit<ComponentProps<T>, 'as'>

/** A panel: a hairline frame on paper, square. Screenshots, waveforms, editor panes. */
export function Panel<T extends ElementType = 'div'>({ as, className, ...props }: As<T>) {
  const Tag: ElementType = as ?? 'div'
  return <Tag className={cx('panel', className)} {...props} />
}

/** A sheet: a framed paper area for a form or a group of settings. */
export function Sheet<T extends ElementType = 'section'>({ as, className, ...props }: As<T>) {
  const Tag: ElementType = as ?? 'section'
  return <Tag className={cx('sheet', className)} {...props} />
}

/** A framed notice. `tone="error"` takes the burgundy frame; give errors role="alert". */
export function Notice<T extends ElementType = 'div'>({ as, tone, className, ...props }: As<T> & { tone?: 'error' }) {
  const Tag: ElementType = as ?? 'div'
  return <Tag className={cx('notice', tone, className)} {...props} />
}

/** An honest empty state: a heading at --t-l, a line of why, and the one action that fixes it. */
export function EmptyState({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('empty', className)} {...props} />
}
