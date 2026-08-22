import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { dialog, overlay } from '../lib/motion'
import { useT } from '../i18n'

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
 * dialog nobody read backs out instead of going through with it, and Tab is
 * kept inside: a modal you can tab out of leaves the keyboard on controls the
 * overlay is covering, with no way to tell what is focused.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel
}: Props): JSX.Element {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const focusable = panel.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Put the keyboard back where it was, not at the top of the document.
      previous?.focus?.()
    }
  }, [onCancel])

  return (
    <AnimatePresence>
      <motion.div
        {...overlay}
        className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
        style={{ zIndex: 'var(--z-modal)' }}
        onClick={onCancel}
      >
        <motion.div
          {...dialog}
          ref={panel}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-body"
          className="panel w-full max-w-sm overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex gap-3 p-4">
            <AlertTriangle size={18} className="mt-[2px] shrink-0 text-bad" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="h2" id="confirm-title">
                {title}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2" id="confirm-body">
                {body}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
            <button className="btn" ref={cancel} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button className="btn-danger" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
