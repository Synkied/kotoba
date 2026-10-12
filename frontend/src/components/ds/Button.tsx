import type { ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { cx } from './cx'
import { buttonClass, type ButtonLook } from './buttonClass'

export function Button({ variant, size, icon, className, ...props }: ButtonLook & ComponentProps<'button'>) {
  return <button className={buttonClass({ variant, size, icon }, className)} {...props} />
}

/** A router link that looks like a Button. */
export function ButtonLink({ variant, size, icon, className, ...props }: ButtonLook & ComponentProps<typeof Link>) {
  return <Link className={buttonClass({ variant, size, icon }, className)} {...props} />
}

/** A wrapping row of buttons with the 8px gap. */
export function ButtonRow({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('btn-row', className)} {...props} />
}
