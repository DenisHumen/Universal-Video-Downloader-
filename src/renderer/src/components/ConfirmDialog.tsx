import { useId, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useT } from '../i18n'
import Modal from './Modal'

interface Props {
  title: string
  body: string
  /** Wording for the button that goes ahead — say what it does, not "OK". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Ask before doing something that cannot be undone.
 *
 * Focus starts on Cancel rather than on the destructive button, so Enter on a
 * dialog nobody read backs out instead of going through with it. Tab, Esc and
 * putting focus back afterwards are the shared Modal's; this dialog had its own
 * copy of them first, and was the only one that did.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel
}: Props): JSX.Element {
  const t = useT()
  const cancel = useRef<HTMLButtonElement>(null)
  // Per dialog, not fixed ids: a confirmation can open over another dialog.
  const titleId = useId()
  const bodyId = useId()

  return (
    <Modal
      role="alertdialog"
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={bodyId}
      initialFocus={cancel}
      className="panel w-full max-w-sm overflow-hidden"
    >
      <div className="flex gap-3 p-4">
        <AlertTriangle size={18} className="mt-[2px] shrink-0 text-bad" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="h2" id={titleId}>
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2" id={bodyId}>
            {body}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
        <button className="btn-quiet" ref={cancel} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
