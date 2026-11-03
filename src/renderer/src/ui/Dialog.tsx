import { useId, type ReactNode, type RefObject } from 'react'
import Modal from '../components/Modal'
import { cx } from './cx'

interface Props {
  title: ReactNode
  /** One or two sentences under the title; it becomes the dialog's description. */
  description?: ReactNode
  children?: ReactNode
  /** The footer's buttons, right-aligned; the primary one last. */
  actions?: ReactNode
  onClose: () => void
  role?: 'dialog' | 'alertdialog'
  initialFocus?: RefObject<HTMLElement>
  /** Panel width. */
  size?: 'sm' | 'md' | 'lg'
  /** An icon beside the title (an alert triangle for a confirmation). */
  icon?: ReactNode
}

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

/**
 * A dialog (plan 3.1): the shared Modal (role and name on the panel, focus in
 * and back, Tab kept inside, Esc for the top dialog only, a scrim behind) with
 * the 4.0 layout on `.surface-dialog`: title, description, body, actions.
 */
export default function Dialog({
  title,
  description,
  children,
  actions,
  onClose,
  role = 'dialog',
  initialFocus,
  size = 'sm',
  icon
}: Props): JSX.Element {
  const titleId = useId()
  const bodyId = useId()
  return (
    <Modal
      role={role}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={description ? bodyId : undefined}
      initialFocus={initialFocus}
      className={cx('surface-dialog flex max-h-full w-full flex-col overflow-hidden', WIDTH[size])}
    >
      <div className="flex gap-3 px-5 pb-3 pt-5">
        {icon && (
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 id={titleId} className="text-section font-semibold text-ink">
            {title}
          </h2>
          {description && (
            <p id={bodyId} className="mt-1 text-control text-ink-2">
              {description}
            </p>
          )}
        </div>
      </div>
      {children && <div className="min-h-0 overflow-y-auto px-5 pb-4">{children}</div>}
      {actions && <div className="flex justify-end gap-2 border-t border-edge-soft px-5 py-3">{actions}</div>}
    </Modal>
  )
}
