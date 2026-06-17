import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, Rocket, X } from 'lucide-react'
import { useStore } from '../store'

export default function UpdateBanner(): JSX.Element | null {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.updateDismissed)
  const dismiss = useStore((s) => s.dismissUpdate)

  const visible =
    !dismissed &&
    (update.state === 'available' ||
      update.state === 'downloading' ||
      update.state === 'downloaded')

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="absolute left-1/2 top-4 z-40 w-[min(640px,calc(100%-2rem))] -translate-x-1/2"
        >
          <div className="glass-strong flex items-center gap-4 rounded-2xl px-5 py-3.5 shadow-glow">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/20 text-accent-300">
              <Rocket size={20} />
            </div>
            <div className="min-w-0 flex-1">
              {update.state === 'available' && (
                <>
                  <p className="text-sm font-semibold text-white">
                    Version {update.version} is available
                  </p>
                  <p className="truncate text-xs text-white/50">
                    A new update is ready to download and install automatically.
                  </p>
                </>
              )}
              {update.state === 'downloading' && (
                <>
                  <p className="text-sm font-semibold text-white">Downloading update…</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-accent-500 to-teal-500"
                      animate={{ width: `${update.percent ?? 0}%` }}
                      transition={{ ease: 'easeOut' }}
                    />
                  </div>
                </>
              )}
              {update.state === 'downloaded' && (
                <>
                  <p className="text-sm font-semibold text-white">
                    Update {update.version} ready to install
                  </p>
                  <p className="truncate text-xs text-white/50">
                    The app will restart to apply the update.
                  </p>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {update.state === 'available' && (
                <button className="btn-primary" onClick={() => window.api.downloadUpdate()}>
                  <Download size={16} /> Update
                </button>
              )}
              {update.state === 'downloaded' && (
                <button className="btn-primary" onClick={() => window.api.installUpdate()}>
                  <RefreshCw size={16} /> Restart &amp; install
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
