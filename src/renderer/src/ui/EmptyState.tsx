import type { ReactNode } from 'react'

interface Props {
  /** A symbolic icon at 128 px (`<Icon size="xl">`), drawn dim. */
  icon: ReactNode
  title: string
  hint?: string
  /** The way out: a suggested pill. A status page without one is a dead end. */
  action?: ReactNode
  /** Extra content under the hint (Download's entry). */
  children?: ReactNode
}

/**
 * AdwStatusPage (A1 D3): a 128 px dimmed symbolic icon, a title-1 heading,
 * body text and a suggested pill, centred in the pane.
 */
export default function EmptyState({ icon, title, hint, action, children }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-ink opacity-50" aria-hidden="true">
        {icon}
      </div>
      <h2 className="mt-6 text-title-1 text-ink">{title}</h2>
      {hint && <p className="mt-3 max-w-[48ch] text-body text-ink">{hint}</p>}
      {children && <div className="mt-6 w-full max-w-[600px]">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
