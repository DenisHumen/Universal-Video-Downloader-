import { AnimatePresence, motion } from 'framer-motion'
import { collapse } from '../lib/motion'
import { Download, ExternalLink, RefreshCw, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * A full-width strip under the chrome rather than a floating card.
 *
 * The old banner was absolutely positioned and centred, which meant it sat on
 * top of the content it was interrupting and needed a static flex parent to
 * survive framer-motion overwriting its transform. A strip has neither problem:
 * it takes its own row, pushes the view down while it exists, and animates on
 * height alone.
 */
export default function UpdateBanner(): JSX.Element {
  const t = useT()
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.updateDismissed)
  const dismiss = useStore((s) => s.dismissUpdate)

  const visible =
    !dismissed &&
    (update.state === 'available' || update.state === 'downloading' || update.state === 'downloaded')

  // Builds that can't self-install (unsigned macOS, .deb/.rpm) send the user to
  // the releases page instead of pretending the app can restart into a new one.
  const manual = Boolean(update.manual)

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div {...collapse} className="shrink-0 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
            <span className="label shrink-0 text-accent-ink">update</span>
            <div className="min-w-0 flex-1">
              {update.state === 'available' && (
                <p className="truncate text-[13px] text-ink">
                  {t('update.available', { version: update.version ?? '' })}
                  <span className="mono ml-2 text-[11px] text-ink-3">
                    {manual ? t('update.availableManualHint') : t('update.availableHint')}
                  </span>
                </p>
              )}
              {update.state === 'downloading' && (
                <div className="flex items-center gap-3">
                  <p className="shrink-0 text-[13px] text-ink">{t('update.downloading')}</p>
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sink">
                    <motion.div
                      className="h-full bg-accent"
                      animate={{ width: `${update.percent ?? 0}%` }}
                      transition={{ ease: 'easeOut' }}
                    />
                  </div>
                  <span className="mono shrink-0 text-[11px] text-ink-3">
                    {Math.round(update.percent ?? 0)}%
                  </span>
                </div>
              )}
              {update.state === 'downloaded' && (
                <p className="truncate text-[13px] text-ink">
                  {t('update.ready', { version: update.version ?? '' })}
                  <span className="mono ml-2 text-[11px] text-ink-3">{t('update.readyHint')}</span>
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {update.state === 'available' && (
                <button className="btn-solid px-3 py-2" onClick={() => window.api.downloadUpdate()}>
                  {manual ? <ExternalLink size={14} /> : <Download size={14} />}
                  {manual ? t('update.getIt') : t('update.action')}
                </button>
              )}
              {update.state === 'downloaded' && (
                <button className="btn-solid px-3 py-2" onClick={() => window.api.installUpdate()}>
                  <RefreshCw size={14} /> {t('update.restart')}
                </button>
              )}
              <button className="btn-icon" onClick={dismiss} aria-label={t('common.close')}>
                <X size={15} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
