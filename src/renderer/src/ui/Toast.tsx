import { useRef, type FocusEvent } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { enter } from '../lib/motion'
import { X } from './icons'
import { useToasts, type Toast } from '../lib/toast'

/** Raise a toast: `toast(message, kind?, action?)`. */
export { toast, type ToastAction, type ToastKind } from '../lib/toast'
import { useT } from '../i18n'


/**
 * The toast viewport (plan 3.1): mount once per window. Each toast is
 * GNOME's: a dark OSD pill at the bottom centre, with one optional action
 * (A1). An error is told apart by its live region (role="alert"), not by
 * colour, which an OSD pill does not carry.
 *
 * Toasts sit bottom-right rather than centred: the centre of this window is
 * where the user is working, and a confirmation shouldn't land on top of it.
 *
 * They used to have no width limit either, so a long share error ran the full
 * width of the window across the trim controls, and they spoke to nobody but
 * the eyes: no live region, so a screen reader never heard a failure that, for
 * a share test or a saved step, is reported nowhere else. Both regions are
 * always mounted, because a live region that appears together with its first
 * message is often not announced at all.
 */
export default function Toasts(): JSX.Element {
  const toasts = useToasts((s) => s.toasts)

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 right-4 flex flex-col items-center"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      <div role="alert" className="flex flex-col items-center">
        <AnimatePresence>
          {toasts
            .filter((t) => t.kind === 'error')
            .map((t) => (
              <ToastCard key={t.id} toast={t} />
            ))}
        </AnimatePresence>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col items-center">
        <AnimatePresence>
          {toasts
            .filter((t) => t.kind !== 'error')
            .map((t) => (
              <ToastCard key={t.id} toast={t} />
            ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/*
  The pointer and the keyboard each hold a toast open, and it only starts
  counting down again once both have left - otherwise tabbing to the close
  button and then moving the mouse away would let it expire under the focus.
*/
function ToastCard({ toast }: { toast: Toast }): JSX.Element {
  const t = useT()
  const held = useRef({ pointer: false, focus: false })

  const hold = (key: 'pointer' | 'focus', on: boolean): void => {
    const was = held.current.pointer || held.current.focus
    held.current[key] = on
    const now = held.current.pointer || held.current.focus
    const { pause, resume } = useToasts.getState()
    if (now && !was) pause(toast.id)
    else if (!now && was) resume(toast.id)
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold('focus', false)
  }

  return (
    <m.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={enter}
      onMouseEnter={() => hold('pointer', true)}
      onMouseLeave={() => hold('pointer', false)}
      onFocus={() => hold('focus', true)}
      onBlur={onBlur}
      className="ui-toast pointer-events-auto mt-2 flex max-w-[min(560px,calc(100vw-32px))] items-center gap-3 py-1.5 pl-5 pr-1.5"
      data-kind={toast.kind}
    >
      <span className="min-w-0 flex-1 text-body text-osd-fg [overflow-wrap:anywhere]">
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          className="shrink-0 rounded-pill px-3 py-1.5 text-control font-bold text-osd-fg hover:bg-osd-fg/10"
          onClick={() => {
            toast.action?.run()
            useToasts.getState().dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="ui-icon-btn ui-icon-btn-circular h-8 w-8 text-osd-fg hover:bg-osd-fg/10"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={() => useToasts.getState().dismiss(toast.id)}
      >
        <X size={13} aria-hidden />
      </button>
    </m.div>
  )
}
