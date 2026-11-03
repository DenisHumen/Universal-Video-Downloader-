import { useEffect, useRef } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { collapse } from '../lib/motion'
import { X } from '../ui/icons'
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
  const prefetchDetect = useStore((s) => s.prefetchDetect)
  const cancelPrefetch = useStore((s) => s.cancelPrefetch)

  /** The link "use it" just handed to Home, whose prefetch Home will adopt. */
  const handedOver = useRef<string | null>(null)

  /*
    Detected while it is being read; see `prefetchDetect`. Called off when the
    strip goes or shows another link - unless it went because the link was
    accepted: this cleanup runs in the same commit as Home's own effect, before
    Home has had the chance to adopt the run.
  */
  useEffect(() => {
    if (!link) return
    prefetchDetect(link)
    return () => {
      if (handedOver.current === link) handedOver.current = null
      else cancelPrefetch(link)
    }
  }, [link, prefetchDetect, cancelPrefetch])

  const accept = (): void => {
    if (!link) return
    // This strip is drawn on every screen; the home view is usually not mounted
    // when it is clicked, which is why handing the link over as an event did
    // nothing at all from the queue, search or settings.
    handedOver.current = link
    requestDetect(link)
    dismiss()
  }

  return (
    <AnimatePresence initial={false}>
      {link && (
        <m.div {...collapse} className="shrink-0 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
            <span className="label shrink-0 text-accent-ink">{t('stamp.clipboard')}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink">{t('home.clipboardFound')}</p>
              <p className="mono truncate text-meta text-ink-2" title={link}>
                {link}
              </p>
            </div>
            {/* Quiet: the strip lands on top of whatever screen is open, each
                with a solid button of its own, and the accent stamp already
                says where to look. */}
            <button className="btn-quiet shrink-0 px-3 py-2" onClick={accept}>
              {t('home.clipboardUse')}
            </button>
            <button className="btn-icon" onClick={dismiss} aria-label={t('common.close')}>
              <X size={15} />
            </button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
