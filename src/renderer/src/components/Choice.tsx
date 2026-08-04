import type { ReactNode } from 'react'

export interface ChoiceOption {
  value: string
  label: ReactNode
  icon?: JSX.Element
  /** Present but not selectable — e.g. a translation locked behind Premium. */
  disabled?: boolean
  title?: string
}

interface Props {
  options: ChoiceOption[]
  value: string
  onChange: (value: string) => void
  /** Accessible name for the group. */
  label?: string
  className?: string
}

/**
 * The system's only single-select control: a wrapping row of pills.
 *
 * This replaces the segmented control the old build used everywhere. That
 * control housed its options in a track and slid a shared indicator between
 * them, which broke down in exactly the places this app needs it most — the
 * quality row is rebuilt per video, so the indicator had nothing stable to
 * travel from, and a track can't wrap, so twelve episodes or eight containers
 * overflowed it. Independent pills wrap freely, survive a rebuilt option list,
 * and read the same whether there are two choices or forty.
 *
 * Selection is a solid accent fill, which is the one place in the system where
 * the brand colour appears at full strength.
 */
export default function Choice({ options, value, onChange, label, className }: Props): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={on}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={`choice ${on ? 'choice-on' : ''} ${opt.disabled ? 'choice-off cursor-not-allowed' : ''}`}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
