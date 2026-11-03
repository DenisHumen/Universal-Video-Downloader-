import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'danger'
export type ControlSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one loud action on a screen; there is never a second. */
  variant?: ButtonVariant
  /** 28 / 34 / 40 px. Every size keeps a 36px pointer target. */
  size?: ControlSize
  /** An icon before the label (an `<Icon>`). */
  icon?: ReactNode
  /** An icon after the label, such as a disclosure chevron. */
  iconEnd?: ReactNode
}

/** The app's button. Shape, size and colour all come from tokens (index.css, `.ui-btn`). */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'quiet', size = 'md', icon, iconEnd, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ui-btn', `ui-h-${size}`, `ui-btn-${variant}`, className)}
      {...rest}
    >
      {icon}
      {children}
      {iconEnd}
    </button>
  )
})

export default Button
