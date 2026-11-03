import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'role' | 'aria-checked'> {
  checked: boolean
  onChange: (next: boolean) => void
}

/**
 * An on/off setting. Named by `aria-label` or `aria-labelledby` (a
 * SettingsRow passes its title's id). The knob slides on a CSS transition;
 * the 36x20 track takes a 40x36 pointer target.
 */
export default function Switch({ checked, onChange, className, disabled, ...rest }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx('ui-switch', className)}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="ui-switch-knob" aria-hidden="true" />
    </button>
  )
}
