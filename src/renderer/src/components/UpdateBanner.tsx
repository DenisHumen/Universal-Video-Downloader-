import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, Rocket, X } from 'lucide-react'
import { useStore } from '../store'

export default function UpdateBanner(): JSX.Element | null {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.updateDismissed)
  const dismiss = useStore((s) => s.dismissUpdate)

  const visible =
    !dismissed &&
    (update.state === 'available' || update.state === 'downloading' || update.state === 'downloaded')

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="absolute left-1/2 top-4 z-40 w-[min(620px,calc(100%-2rem))] -translate-x-1/2"
        >
          <div className="flex items-center gap-4 rounded-3xl border border-white/[0.09] bg-ink-750 px-5 py-3.5 shadow-soft backdrop-blur-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-cream">
              <Rocket size={19} />
            </div>
            <div className="min-w-0 flex-1">
              {update.state === 'available' && (
                <>
                  <p className="text-sm font-semibold text-cream">version {update.version} is available</p>
                  <p className="mono truncate text-xs text-white/45">ready to download and install</p>
                </>
              )}
              {update.state === 'downloading' && (
                <>
                  <p className="text-sm font-semibold text-cream">downloading update…</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-cream"
                      animate={{ width: `${update.percent ?? 0}%` }}
                      transition={{ ease: 'easeOut' }}
                    />
                  </div>
                </>
              )}
              {update.state === 'downloaded' && (
                <>
                  <p className="text-sm font-semibold text-cream">update {update.version} ready</p>
                  <p className="mono truncate text-xs text-white/45">the app will restart to apply it</p>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {update.state === 'available' && (
                <button className="btn-primary" onClick={() => window.api.downloadUpdate()}>
                  <Download size={16} /> update
                </button>
              )}
              {update.state === 'downloaded' && (
                <button className="btn-primary" onClick={() => window.api.installUpdate()}>
                  <RefreshCw size={16} /> restart
                </button>
              )}
              <button className="btn-icon" onClick={dismiss} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
