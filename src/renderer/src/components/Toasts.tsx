import { useRef, type FocusEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { enter } from '../lib/motion'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToasts, type Toast } from '../lib/toast'
import { useT } from '../i18n'

const ICON = {
  info: <Info size={14} aria-hidden className="mt-[3.5px] shrink-0 text-ink-3" />,
  success: <CheckCircle2 size={14} aria-hidden className="mt-[3.5px] shrink-0 text-good" />,
  error: <AlertCircle size={14} aria-hidden className="mt-[3.5px] shrink-0 text-bad" />
}

/**
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
      className="pointer-events-none fixed bottom-4 left-4 right-4 flex flex-col items-end"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      <div role="alert" className="flex flex-col items-end">
        <AnimatePresence>
          {toasts
            .filter((t) => t.kind === 'error')
            .map((t) => (
              <ToastCard key={t.id} toast={t} />
            ))}
        </AnimatePresence>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col items-end">
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
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={enter}
      onMouseEnter={() => hold('pointer', true)}
      onMouseLeave={() => hold('pointer', false)}
      onFocus={() => hold('focus', true)}
      onBlur={onBlur}
      className="pointer-events-auto mt-2 flex max-w-[min(420px,calc(100vw-32px))] items-start gap-2.5 rounded-2 border border-edge bg-raise py-2.5 pl-3.5 pr-2"
    >
      {ICON[toast.kind]}
      <span className="min-w-0 flex-1 text-[14px] text-ink [overflow-wrap:anywhere]">
        {toast.message}
      </span>
      <button
        type="button"
        className="btn-icon-bare -my-0.5 h-6 w-6"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={() => useToasts.getState().dismiss(toast.id)}
      >
        <X size={13} aria-hidden />
      </button>
    </motion.div>
  )
}
