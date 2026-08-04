import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useStore } from './store'
import AuroraBackground from './components/AuroraBackground'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import UpdateBanner from './components/UpdateBanner'
import HomeView from './views/HomeView'
import DownloadsView from './views/DownloadsView'
import SettingsView from './views/SettingsView'
import SearchView from './views/SearchView'
import Logo from './components/Logo'
import MacNotice from './components/MacNotice'
import Toasts from './components/Toasts'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import ClipboardPrompt from './components/ClipboardPrompt'
import { useShortcuts } from './hooks/useShortcuts'
import { useT } from './i18n'

export default function App(): JSX.Element {
  const t = useT()
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  useShortcuts()

  return (
    <>
      <AuroraBackground />
      <TitleBar />
      <Toasts />
      <ShortcutsOverlay />

      <div className="relative flex min-h-0 flex-1 gap-0 px-3 pb-3">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col gap-2.5">
          <UpdateBanner />
          <MacNotice />
          <ClipboardPrompt />
          <div className="panel relative min-h-0 flex-1 overflow-hidden shadow-panel">
            {/*
              Views swap instantly and only animate *in*. They used to sit in an
              `AnimatePresence mode="wait"`, which holds the new view back until
              the old one's exit animation reports completion — so any stall in
              the animation loop (a throttled background window, a GPU hiccup)
              left the panel blank. Navigation should never depend on that.
            */}
            {ready ? (
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={view === 'search' ? 'h-full' : 'h-full overflow-y-auto'}
              >
                {view === 'home' && <HomeView />}
                {view === 'search' && <SearchView settings={settings} embedded />}
                {view === 'downloads' && <DownloadsView />}
                {view === 'settings' && <SettingsView />}
              </motion.div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center">
                <motion.div
                  animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.05, 1] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Logo className="h-14 w-14" />
                </motion.div>
                <p className="mono mt-4 text-sm text-fg/40">{t('error.starting')}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
