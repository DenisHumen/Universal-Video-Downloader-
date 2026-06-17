import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store'
import AuroraBackground from './components/AuroraBackground'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import UpdateBanner from './components/UpdateBanner'
import HomeView from './views/HomeView'
import DownloadsView from './views/DownloadsView'
import SettingsView from './views/SettingsView'
import Logo from './components/Logo'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <>
      <AuroraBackground />
      <TitleBar />

      <div className="relative flex min-h-0 flex-1 gap-0 px-3 pb-3">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          <UpdateBanner />
          <div className="panel h-full overflow-hidden shadow-panel">
            <AnimatePresence mode="wait">
              {!ready ? (
                <motion.div
                  key="splash"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex h-full flex-col items-center justify-center"
                >
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.05, 1] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Logo className="h-14 w-14" />
                  </motion.div>
                  <p className="mono mt-4 text-sm text-white/40">starting up…</p>
                </motion.div>
              ) : (
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="h-full overflow-y-auto"
                >
                  {view === 'home' && <HomeView />}
                  {view === 'downloads' && <DownloadsView />}
                  {view === 'settings' && <SettingsView />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </>
  )
}
