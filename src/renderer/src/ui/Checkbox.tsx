import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cx } from './cx'

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'role' | 'aria-checked'> {
  checked: boolean | 'mixed'
  onChange: (next: boolean) => void
  /** A visible label beside the box. Without one, give it `aria-label`. */
  children?: ReactNode
}

/**
 * A checkbox: a 16px box with a pointer target of 36px. `mixed` shows a dash,
 * for "some of these" (a season with some episodes picked).
 */
export default function Checkbox({
  checked,
  onChange,
  children,
  className,
  ...rest
}: CheckboxProps): JSX.Element {
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx('ui-check', !children && className)}
      onClick={() => onChange(checked !== true)}
      {...rest}
    >
      {checked === true && <Check size={12} strokeWidth={3} aria-hidden="true" />}
      {checked === 'mixed' && <Minus size={12} strokeWidth={3} aria-hidden="true" />}
    </button>
  )
  if (!children) return box
  // The label names the box and is part of the target: a click on the words is forwarded to it.
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-body text-ink', className)}>
      {box}
      <span>{children}</span>
    </label>
  )
}
