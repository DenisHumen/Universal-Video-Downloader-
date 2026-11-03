import type { ReactNode } from 'react'

interface Props {
  /** A 24px icon (an `<Icon size="lg">`). */
  icon: ReactNode
  title: string
  hint?: string
  /** The way out: a primary action. An empty state without one is a dead end. */
  action?: ReactNode
}

/**
 * "Nothing here", with the next step (plan 3.1, VD spec): a 48px icon tile on
 * `--surface-2` at r-3, the icon in accent ink, a 16/600 title, a 13px hint and
 * a primary action, centred at about 40% of the height.
 */
export default function EmptyState({ icon, title, hint, action }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center px-6 pb-16 pt-[22vh] text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-3 bg-sink text-accent-ink"
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="mt-4 text-section font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1.5 max-w-[46ch] text-control text-ink-2">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
