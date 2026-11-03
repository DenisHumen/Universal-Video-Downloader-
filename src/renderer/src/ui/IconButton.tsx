import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Tooltip from './Tooltip'
import { cx } from './cx'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: the glyph is the only thing naming the action. It is the accessible name and the tooltip. */
  label: string
  icon: ReactNode
  /** Visual box 28 or 34 px; the hit area is never under 36 px. */
  size?: 'sm' | 'md'
  /** Leave the tooltip off where the label is visible next to it anyway. */
  tooltip?: boolean
  tooltipSide?: 'bottom' | 'top' | 'right'
}

/** An icon-only control: always labelled, always a 36 px target, a tooltip after 500 ms. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', tooltip = true, tooltipSide, className, type = 'button', ...rest },
  ref
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx('ui-icon-btn', `ui-icon-btn-${size}`, className)}
      {...rest}
    >
      {icon}
    </button>
  )
  return tooltip ? (
    <Tooltip label={label} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  )
})

export default IconButton
