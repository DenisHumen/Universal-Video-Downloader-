import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

interface Props<T extends string> {
  /** Two to five options. More than five is a list or a select, not a segmented control. */
  options: Segment<T>[]
  value: T
  onChange: (value: T) => void
  /** The group's accessible name. */
  label: string
  className?: string
}

/**
 * One value out of two to five, shown side by side (plan 3.1).
 *
 * A radio group for assistive tech: one tab stop, arrows move and select,
 * Home/End jump. The selected segment is a raised plane, not a sliding
 * indicator: a re-rendered option list has nothing to slide from.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className
}: Props<T>): JSX.Element {
  if (options.length < 2 || options.length > 5) {
    // A list or a select fits better; ui.test.tsx holds the contract.
    console.warn(`SegmentedControl "${label}" has ${options.length} options; it is for 2 to 5.`)
  }
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const current = options.findIndex((o) => o.value === value)

  const move = (to: number): void => {
    const opt = options[to]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    refs.current[to]?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const pos = enabled.indexOf(current)
    const step = (d: number): number => enabled[(pos + d + enabled.length) % enabled.length]
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? step(1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? step(-1)
          : e.key === 'Home'
            ? enabled[0]
            : e.key === 'End'
              ? enabled[enabled.length - 1]
              : undefined
    if (next === undefined) return
    e.preventDefault()
    move(next)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx('ui-segmented', className)} onKeyDown={onKey}>
      {options.map((opt, i) => {
        const on = i === current
        return (
          <button
            key={opt.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={opt.disabled}
            // One tab stop: the selected segment, or the first when nothing is.
            tabIndex={on || (current < 0 && i === enabled[0]) ? 0 : -1}
            className="ui-segment"
            onClick={() => move(i)}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
