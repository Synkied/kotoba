import type { ComponentProps } from 'react'
import { cx } from './cx'

/** A label: a kraft tag. Up to three per source; also the source/time/tries facts beside a sentence. */
export function Chip({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('chip', className)} {...props} />
}

/** A filter chip: a kraft tag you can press. Pass `aria-pressed`; pressed chips reverse to ink. */
export function ChipButton({ className, ...props }: ComponentProps<'button'>) {
  return <button className={cx('chip', className)} {...props} />
}

/**
 * An ink plate: categories and counts.
 * `tone="accent"` (burgundy) only for what is due or missed; `hollow` is the quiet hairline.
 */
export function Plate({ tone, className, ...props }: { tone?: 'accent' | 'hollow' } & ComponentProps<'span'>) {
  return <span className={cx('plate', tone, className)} {...props} />
}

/** A key, as in "press /". */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={cx('kbd', className)} {...props} />
}
