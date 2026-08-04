import { AnimatePresence, motion } from 'framer-motion'
import { modalSpring } from '../lib/motion'
import { Download, ExternalLink, RefreshCw, Rocket, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

export default function UpdateBanner(): JSX.Element | null {
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

  // Centering is done by this static flex parent — not by a transform on the
  // motion element — because framer-motion's inline transform (y/scale) would
  // otherwise override a Tailwind -translate-x-1/2 and push the banner off-screen.
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center px-4">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={modalSpring}
            className="pointer-events-auto w-full max-w-[600px]"
          >
            <div className="flex items-center gap-3 rounded-3xl border border-fg/[0.09] bg-ink-750 px-4 py-3.5 shadow-soft backdrop-blur-xl">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fg/[0.06] text-cream">
                <Rocket size={19} />
              </div>
              <div className="min-w-0 flex-1">
                {update.state === 'available' && (
                  <>
                    <p className="truncate text-sm font-semibold text-cream">
                      {t('update.available', { version: update.version ?? '' })}
                    </p>
                    <p className="mono truncate text-xs text-fg/60">
                      {manual ? t('update.availableManualHint') : t('update.availableHint')}
                    </p>
                  </>
                )}
                {update.state === 'downloading' && (
                  <>
                    <p className="text-sm font-semibold text-cream">{t('update.downloading')}</p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
                      <motion.div
                        className="h-full rounded-full bg-accent"
                        animate={{ width: `${update.percent ?? 0}%` }}
                        transition={{ ease: 'easeOut' }}
                      />
                    </div>
                  </>
                )}
                {update.state === 'downloaded' && (
                  <>
                    <p className="truncate text-sm font-semibold text-cream">
                      {t('update.ready', { version: update.version ?? '' })}
                    </p>
                    <p className="mono truncate text-xs text-fg/60">{t('update.readyHint')}</p>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {update.state === 'available' && (
                  <button className="btn-primary px-3.5" onClick={() => window.api.downloadUpdate()}>
                    {manual ? <ExternalLink size={16} /> : <Download size={16} />}
                    {manual ? t('update.getIt') : t('update.action')}
                  </button>
                )}
                {update.state === 'downloaded' && (
                  <button className="btn-primary px-3.5" onClick={() => window.api.installUpdate()}>
                    <RefreshCw size={16} /> {t('update.restart')}
                  </button>
                )}
                <button className="btn-icon" onClick={dismiss} aria-label={t('common.close')}>
                  <X size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
