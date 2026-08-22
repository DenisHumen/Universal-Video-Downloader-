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
  const requestDetect = useStore((s) => s.requestDetect)

  const accept = (): void => {
    if (!link) return
    // This strip is drawn on every screen; the home view is usually not mounted
    // when it is clicked, which is why handing the link over as an event did
    // nothing at all from the queue, search or settings.
    requestDetect(link)
    dismiss()
  }

  return (
    <AnimatePresence initial={false}>
      {link && (
        <motion.div {...collapse} className="shrink-0 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
            <span className="label shrink-0 text-accent-ink">{t('stamp.clipboard')}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">{t('home.clipboardFound')}</p>
              <p className="mono truncate text-[12px] text-ink-2" title={link}>
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
