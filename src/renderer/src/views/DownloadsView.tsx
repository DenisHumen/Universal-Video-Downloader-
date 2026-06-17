import { AnimatePresence, motion } from 'framer-motion'
import { Inbox, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import DownloadCard from '../components/DownloadCard'

export default function DownloadsView(): JSX.Element {
  const downloads = useStore((s) => s.downloads)
  const setView = useStore((s) => s.setView)

  const hasFinished = downloads.some((d) =>
    ['completed', 'error', 'canceled'].includes(d.state)
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Downloads</h1>
          <p className="text-sm text-white/40">
            {downloads.length} item{downloads.length === 1 ? '' : 's'} in your queue
          </p>
        </div>
        {hasFinished && (
          <button className="btn-ghost" onClick={() => window.api.clearFinished()}>
            <Trash2 size={16} /> Clear finished
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {downloads.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[0.03] text-white/20">
              <Inbox size={36} />
            </div>
            <p className="mt-4 text-sm font-medium text-white/60">No downloads yet</p>
            <p className="mt-1 text-xs text-white/35">Paste a link to get started</p>
            <button className="btn-primary mt-5" onClick={() => setView('home')}>
              Add a download
            </button>
          </motion.div>
        ) : (
          <div className="space-y-3 pb-4">
            <AnimatePresence mode="popLayout">
              {downloads.map((item) => (
                <DownloadCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
