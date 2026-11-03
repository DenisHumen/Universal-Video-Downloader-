import { useRef } from 'react'
import { useT } from '../i18n'
import Dialog from '../ui/Dialog'

interface Props {
  title: string
  body: string
  /** Wording for the button that goes ahead — say what it does, not "OK". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Ask before doing something that cannot be undone: GNOME's AlertDialog
 * (ui/Dialog), the destructive response last.
 *
 * Focus starts on Cancel rather than on the destructive button, so Enter on a
 * dialog nobody read backs out instead of going through with it. Tab, Esc and
 * putting focus back afterwards are the shared Modal's.
 */
export default function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props): JSX.Element {
  const t = useT()
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      role="alertdialog"
      title={title}
      description={body}
      onClose={onCancel}
      initialFocus={cancel}
      actions={
        <>
          <button className="btn-quiet" ref={cancel} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    />
  )
}
