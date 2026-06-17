import { AnimatePresence, motion } from 'framer-motion'
import { FolderOpen, Inbox, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import DownloadCard from '../components/DownloadCard'

export default function DownloadsView(): JSX.Element {
  const downloads = useStore((s) => s.downloads)
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)

  const hasFinished = downloads.some((d) => ['completed', 'error', 'canceled'].includes(d.state))

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-8 py-9">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-cream">queue</h1>
          <p className="mono text-sm text-white/40">
            {downloads.length} item{downloads.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settings?.downloadDir && (
            <button className="btn-ghost" onClick={() => window.api.openPath(settings.downloadDir)}>
              <FolderOpen size={16} /> open folder
            </button>
          )}
          {hasFinished && (
            <button className="btn-ghost" onClick={() => window.api.clearFinished()}>
              <Trash2 size={16} /> clear finished
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {downloads.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.03] text-white/20">
              <Inbox size={34} />
            </div>
            <p className="mt-4 text-sm font-medium text-white/55">nothing here yet</p>
            <p className="mono mt-1 text-xs text-white/30">paste a link to get started</p>
            <button className="btn-primary mt-5" onClick={() => setView('home')}>
              add a download
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
