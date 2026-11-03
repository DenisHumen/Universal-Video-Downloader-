import { useEffect } from 'react'
import { useStore } from './store'
import Shell from './shell/Shell'
import CommandPalette from './components/CommandPalette'
import FirstRunSetup from './components/FirstRunSetup'
import UpdateBanner from './components/UpdateBanner'
import EngineNotice from './components/EngineNotice'
import HomeView from './views/HomeView'
import DownloadsView from './views/DownloadsView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/settings/SettingsView'
import AutomationView from './views/AutomationView'
import SearchView from './views/SearchView'
import Logo from './components/Logo'
import MacNotice from './components/MacNotice'
import { ToastViewport as Toasts } from './ui'
import LiveRegion from './components/LiveRegion'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import ClipboardPrompt from './components/ClipboardPrompt'
import DropOverlay from './components/DropOverlay'
import { useShortcuts } from './hooks/useShortcuts'
import { usePasteDetect } from './hooks/usePasteDetect'
import { useT } from './i18n'

export default function App(): JSX.Element {
  const t = useT()
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)
  const platform = useStore((s) => s.appInfo?.platform)

  useEffect(() => {
    void init()
  }, [init])

  useShortcuts()
  const dragging = usePasteDetect()

  return (
    <>
      <Toasts />
      {/* Outcomes as text, for anyone not watching the window. */}
      <LiveRegion />
      <ShortcutsOverlay />
      <CommandPalette />
      <FirstRunSetup />
      {dragging && <DropOverlay />}

      <Shell
        platform={platform}
        /*
          Notices are full-width strips pinned under the sheet's top, not
          floating cards: they're part of the window's structure while they
          exist, and pushing content down is honest about that.
        */
        notices={
          <>
            <EngineNotice />
            <UpdateBanner />
            <MacNotice />
            <ClipboardPrompt />
          </>
        }
      >
      <main className="relative flex min-h-0 flex-1 flex-col">
        {ready ? (
          <div
            key={view}
            /*
              Opacity only — no transform.
              This element is the scroll host and the flex child that fills the
              window. A transform on it paints outside those bounds (measured:
              6px of phantom document scroll) and leaves the entire screen
              offset if the animation ever stalls. Each view animates its own
              content instead.

              A CSS keyframe, not framer-motion. The library steps its values
              from requestAnimationFrame, which does not tick in a throttled
              window: a tab switch in a backgrounded app held the new view at
              opacity 0 - a blank window - until the frame clock came back. A
              keyframe runs on the compositor's own timeline and, with no fill
              mode, leaves the element at full opacity the moment it ends or
              is skipped (reduced motion shortens it to nothing).

              Views swap instantly and only animate *in*: an exit animation
              would hold the incoming view back on the same clock.
            */
            /* Each view owns its own scrolling, so it can pin its header and
               keep a sticky rail in sync with the content underneath it. */
            className="min-h-0 flex-1 animate-view-in overflow-hidden"
          >
            {view === 'home' && <HomeView />}
            {view === 'search' && <SearchView settings={settings} embedded />}
            {view === 'downloads' && <DownloadsView />}
            {view === 'library' && <LibraryView />}
            {view === 'automation' && <AutomationView />}
            {view === 'settings' && <SettingsView />}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <Logo className="h-7 w-7 animate-idle-pulse text-ink-3" />
            <p className="label">{t('error.starting')}</p>
          </div>
        )}
      </main>
      </Shell>
    </>
  )
}
