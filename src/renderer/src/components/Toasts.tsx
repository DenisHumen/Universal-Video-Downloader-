import { AnimatePresence, motion } from 'framer-motion'
import { enter } from '../lib/motion'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useToasts } from '../lib/toast'

const ICON = {
  info: <Info size={14} className="text-ink-3" />,
  success: <CheckCircle2 size={14} className="text-good" />,
  error: <AlertCircle size={14} className="text-bad" />
}

/**
 * Toasts sit bottom-right rather than centred: the centre of this window is
 * where the user is working, and a confirmation shouldn't land on top of it.
 */
export default function Toasts(): JSX.Element {
  const toasts = useToasts((s) => s.toasts)

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 flex flex-col items-end gap-2"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={enter}
            className="pointer-events-auto flex items-center gap-2.5 rounded-2 border border-edge bg-raise px-3.5 py-2.5"
          >
            {ICON[t.kind]}
            <span className="text-[13px] text-ink">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
