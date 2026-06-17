import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useToasts } from '../lib/toast'

const ICON = {
  info: <Info size={16} className="text-white/60" />,
  success: <CheckCircle2 size={16} className="text-emerald-300" />,
  error: <AlertCircle size={16} className="text-red-300" />
}

export default function Toasts(): JSX.Element {
  const toasts = useToasts((s) => s.toasts)

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-white/10 bg-ink-750/95 px-4 py-2.5 shadow-soft backdrop-blur-xl"
          >
            {ICON[t.kind]}
            <span className="text-sm text-cream">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
