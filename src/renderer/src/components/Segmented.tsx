import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export interface SegOption {
  value: string
  label: ReactNode
  icon?: JSX.Element
}

interface Props {
  options: SegOption[]
  value: string
  onChange: (v: string) => void
  layoutId: string
  className?: string
  fill?: boolean
}

/** Cobalt-style segmented control: a row of choices with a sliding light pill. */
export default function Segmented({
  options,
  value,
  onChange,
  layoutId,
  className,
  fill = true
}: Props): JSX.Element {
  return (
    <div className={`seg ${className ?? ''}`}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`seg-item ${fill ? 'flex-1' : ''} ${active ? 'seg-item-active' : ''}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-cream"
                transition={{ type: 'spring', stiffness: 480, damping: 40 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
