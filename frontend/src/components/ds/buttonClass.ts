import { cx } from './cx'

/**
 * Buttons: an ink outline by default, `primary` is ink, `accent` (burgundy) is for recording only, `ghost` has no frame.
 * `size="small"` is the 30px control (44px on touch), `icon` makes it square for an icon alone
 * (give it an aria-label). Hover, active, disabled and aria-busy states come from controls.css.
 * No default `type`: inside a form a Button submits, as a native button does.
 */
export type ButtonLook = {
  variant?: 'primary' | 'ghost' | 'accent'
  size?: 'small'
  icon?: boolean
}

export const buttonClass = ({ variant, size, icon }: ButtonLook, className?: string) =>
  cx('btn', variant, size, icon && 'icon', className)
