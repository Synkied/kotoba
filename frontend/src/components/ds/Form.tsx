import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

/** A label above its control: `<Field><span>Name</span><Input /></Field>`. */
export function Field({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cx('field', className)} {...props} />
}

/** Text input on paper with the thin ink frame; aria-invalid turns the frame red. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx('input', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx('textarea', className)} {...props} />
}

/** A native select; its options keep ink on paper in every theme and toolbar. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx('select', className)} {...props} />
}

/** An ink checkbox (18px, 24px on touch). Pass type="checkbox". */
export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx('check', className)} {...props} />
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean; title?: string }

/**
 * A segmented control: native radios in one thin ink frame; the checked segment reverses to ink.
 * Pass role="radiogroup" and an aria-label unless a labelled group already wraps it.
 */
export function Segmented<T extends string>({ name, value, options, onChange, className, ...props }:
  { name: string; value: T; options: SegmentOption<T>[]; onChange: (v: T) => void } & Omit<ComponentProps<'div'>, 'onChange'>) {
  return (
    <div className={cx('seg', className)} {...props}>
      {options.map((o) => (
        <label key={o.value} title={o.title}>
          <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
