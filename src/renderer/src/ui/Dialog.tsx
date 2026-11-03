import { useId, type ReactNode, type RefObject } from 'react'
import Modal from '../components/Modal'
import { cx } from './cx'

interface Props {
  title: ReactNode
  /** One or two sentences under the heading; it becomes the dialog's description. */
  description?: ReactNode
  children?: ReactNode
  /** The responses, in one row, the suggested or destructive one last. */
  actions?: ReactNode
  onClose: () => void
  role?: 'dialog' | 'alertdialog'
  initialFocus?: RefObject<HTMLElement>
  /** Panel width. */
  size?: 'sm' | 'md' | 'lg'
  /** An icon above the heading. */
  icon?: ReactNode
}

const WIDTH = { sm: 'max-w-[372px]', md: 'max-w-lg', lg: 'max-w-2xl' }

/**
 * AdwAlertDialog (A1 D3): a centred heading (title-2) and body, then the
 * responses side by side, each as wide as the others. On the shared Modal:
 * role and name on the panel, focus in and back, Tab kept inside, Esc for
 * the top dialog, a scrim behind. No bottom sheet: the window never gets
 * narrower than 720 px.
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
      <div className="px-6 pb-4 pt-6 text-center">
        {icon && (
          <div className="mb-3 flex justify-center" aria-hidden="true">
            {icon}
          </div>
        )}
        <h2 id={titleId} className="text-title-2 text-ink">
          {title}
        </h2>
        {description && (
          <p id={bodyId} className="mt-2 text-body text-ink">
            {description}
          </p>
        )}
      </div>
      {children && <div className="min-h-0 overflow-y-auto px-6 pb-4">{children}</div>}
      {actions && <div className="flex gap-3 px-6 pb-6 pt-2 [&>*]:flex-1">{actions}</div>}
    </Modal>
  )
}
