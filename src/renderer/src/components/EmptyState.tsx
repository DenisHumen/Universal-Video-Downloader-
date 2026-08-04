import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  hint?: string
  /** The way out. An empty state without one is a dead end. */
  action?: ReactNode
}

/**
 * The one empty state in the app.
 *
 * Every "nothing here" screen used to be two lines of grey text floating in the
 * middle of the window — technically true, and no help at all: it named the
 * situation without offering a way out of it. This gives the eye something to
 * land on, says what happened, and always carries the next step.
 */
export default function EmptyState({ icon, title, hint, action }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-3 border border-edge bg-sink text-ink-3"
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="h2 mt-5">{title}</p>
      {hint && <p className="hint mt-2">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
