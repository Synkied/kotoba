import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Button, type ButtonLook } from './ds'

/** A button that opens a short list of actions under it. Arrows move through the list,
 *  Escape closes it and returns to the button, a click elsewhere closes it. */
export function Menu({ label, children, content, align = 'end', className, ...look }: ButtonLook & {
  /** the button's accessible name, and its text unless `content` is given */
  label: string
  /** what the button shows, when it isn't the label (an icon alone, an icon and a word) */
  content?: ReactNode
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const items = () => [...box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []]
  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    const list = items(), at = list.indexOf(document.activeElement as HTMLElement)
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key]
    if (to !== undefined) { e.preventDefault(); list[(to + list.length) % list.length]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <div className={'menu' + (className ? ` ${className}` : '')} ref={box} onKeyDown={onKeyDown}>
      <Button ref={button} type="button" {...look} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={content ? label : undefined} title={content ? label : undefined} onClick={() => setOpen(o => !o)}>
        {content ?? label}
      </Button>
      {open && <div role="menu" id={id} aria-label={label} className="menu-list" data-align={align}
        onClick={e => { if ((e.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false) }}>{children}</div>}
    </div>
  )
}

/** One action in a Menu. */
export function MenuItem({ children, className, ...props }: ComponentProps<'button'>) {
  return <button type="button" role="menuitem" tabIndex={-1} className={'menu-item' + (className ? ` ${className}` : '')} {...props}>{children}</button>
}

/** A rule between groups of actions in a Menu. */
export function MenuRule() {
  return <hr className="menu-rule" />
}
