import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardCheck, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * Shown when the clipboard watcher spots a link the queue doesn't have yet.
 * Deliberately a suggestion, never an action: nothing downloads until asked.
 */
export default function ClipboardPrompt(): JSX.Element | null {
  const t = useT()
  const link = useStore((s) => s.clipboardLink)
  const dismiss = useStore((s) => s.dismissClipboardLink)
  const setView = useStore((s) => s.setView)

  const accept = (): void => {
    if (!link) return
    window.dispatchEvent(new CustomEvent<string>('uvd:detect-url', { detail: link }))
    setView('home')
    dismiss()
  }

  return (
    <AnimatePresence>
      {link && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="shrink-0"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/[0.07] px-4 py-2.5">
            <ClipboardCheck size={17} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-cream">{t('home.clipboardFound')}</p>
              <p className="mono truncate text-[11px] text-fg/60" title={link}>
                {link}
              </p>
            </div>
            <button className="btn-primary shrink-0 px-3 py-2 text-xs" onClick={accept}>
              {t('home.clipboardUse')}
            </button>
            <button className="btn-icon shrink-0" onClick={dismiss} aria-label={t('common.close')}>
              <X size={15} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
