import type { ComponentProps } from 'react'
import { cx } from './cx'

/** A label: boxed 1px in ink. Up to three per source. */
export function Chip({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('chip', className)} {...props} />
}

/** A filter chip. Pass `aria-pressed`; pressed chips reverse to ink. */
export function ChipButton({ className, ...props }: ComponentProps<'button'>) {
  return <button className={cx('chip', className)} {...props} />
}

/**
 * A black reversal plate: categories, counts, the rank of a heading.
 * `tone="red"` only for what is due or missed; `hollow` is the quiet outline.
 */
export function Plate({ tone, className, ...props }: { tone?: 'red' | 'hollow' } & ComponentProps<'span'>) {
  return <span className={cx('plate', tone, className)} {...props} />
}

/** A key, as in "press /". */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={cx('kbd', className)} {...props} />
}
