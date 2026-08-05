import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { enter } from './lib/motion'
import { useStore } from './store'
import TopBar from './components/TopBar'
import UpdateBanner from './components/UpdateBanner'
import HomeView from './views/HomeView'
import DownloadsView from './views/DownloadsView'
import SettingsView from './views/SettingsView'
import SearchView from './views/SearchView'
import Logo from './components/Logo'
import MacNotice from './components/MacNotice'
import Toasts from './components/Toasts'
import LiveRegion from './components/LiveRegion'
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
      <TopBar />
      <Toasts />
      {/* Outcomes as text, for anyone not watching the window. */}
      <LiveRegion />
      <ShortcutsOverlay />

      {/*
        Notices are full-width strips pinned under the chrome, not floating
        cards: they're part of the window's structure while they exist, and
        pushing content down is honest about that.
      */}
      <UpdateBanner />
      <MacNotice />
      <ClipboardPrompt />

      <main className="relative flex min-h-0 flex-1 flex-col">
        {ready ? (
          <motion.div
            key={view}
            /*
              Opacity only — no transform.
              This element is the scroll host and the flex child that fills the
              window. A transform on it paints outside those bounds (measured:
              6px of phantom document scroll) and leaves the entire screen
              offset if the animation ever stalls. Each view animates its own
              content instead.
            */
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={enter}
            /*
              Views swap instantly and only animate *in*. An AnimatePresence
              with mode="wait" holds the incoming view back until the outgoing
              one reports its exit finished — so any stall in the animation loop
              (a throttled background window, a GPU hiccup) leaves the window
              blank. Navigation must never depend on that.
            */
            /* Each view owns its own scrolling, so it can pin its header and
               keep a sticky rail in sync with the content underneath it. */
            className="min-h-0 flex-1 overflow-hidden"
          >
            {view === 'home' && <HomeView />}
            {view === 'search' && <SearchView settings={settings} embedded />}
            {view === 'downloads' && <DownloadsView />}
            {view === 'settings' && <SettingsView />}
          </motion.div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Logo className="h-7 w-7 animate-idle-pulse text-ink-3" />
            <p className="label">{t('error.starting')}</p>
          </div>
        )}
      </main>
    </>
  )
}
