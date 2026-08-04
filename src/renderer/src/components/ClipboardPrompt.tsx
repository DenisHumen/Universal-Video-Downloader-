import { AnimatePresence, motion } from 'framer-motion'
import { collapse } from '../lib/motion'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * Shown when the clipboard watcher spots a link the queue doesn't have yet.
 * Deliberately a suggestion, never an action: nothing downloads until asked.
 */
export default function ClipboardPrompt(): JSX.Element {
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
    <AnimatePresence initial={false}>
      {link && (
        <motion.div {...collapse} className="shrink-0 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
            <span className="label shrink-0 text-accent-ink">clipboard</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">{t('home.clipboardFound')}</p>
              <p className="mono truncate text-[11px] text-ink-3" title={link}>
                {link}
              </p>
            </div>
            <button className="btn-solid shrink-0 px-3 py-2" onClick={accept}>
              {t('home.clipboardUse')}
            </button>
            <button className="btn-icon" onClick={dismiss} aria-label={t('common.close')}>
              <X size={15} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
