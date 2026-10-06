import { useEffect, useState } from 'react'
import { Minus, X } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import Logo from './components/Logo'
import Toasts from './components/Toasts'
import SearchView from './views/SearchView'
import { useStore } from './store'
import { applyAppearance } from './lib/theme'
import { useT } from './i18n'

/** Shell for the dedicated title-search window. */
export default function SearchApp(): JSX.Element {
  const t = useT()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    void (async () => {
      const [next, info] = await Promise.all([window.api.getSettings(), window.api.getAppInfo()])
      applyAppearance(next, info.locale)
      setSettings(next)
      setIsMac(info.platform === 'darwin')
      // Share settings with the store so the embedded StreamingCard (anime
      // picker) honours the user's default quality.
      useStore.setState({ settings: next, appInfo: info })
    })()
  }, [])

  /*
    Read again whenever the window comes forward. It used to read the settings
    once, when it opened, so a change made in the main window meanwhile - the
    theme, the language, adult sites switched off for search - never reached
    it, and it went on offering a service main would now refuse.
  */
  useEffect(() => {
    const refresh = (): void => {
      void window.api.getSettings().then((next) => {
        const info = useStore.getState().appInfo
        if (info) applyAppearance(next, info.locale)
        setSettings(next)
        useStore.setState({ settings: next })
      })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  return (
    <>
      <Toasts />

      <header
        className="drag-region relative flex h-12 shrink-0 items-center justify-between border-b border-edge bg-canvas pr-2"
        style={{ zIndex: 'var(--z-chrome)', paddingLeft: isMac ? 76 : 16 }}
      >
        <div className="flex items-center gap-2.5">
          <Logo className="h-[18px] w-[18px] text-ink" />
          <span className="mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ink">
            {t('nav.search')}
          </span>
        </div>
        {!isMac && (
          <div className="flex items-center">
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink"
              onClick={() => window.api.minimizeWindow()}
              aria-label="Minimize"
            >
              <Minus size={15} />
            </button>
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-bad hover:text-white"
              onClick={() => window.api.closeWindow()}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <SearchView settings={settings} />
      </main>
    </>
  )
}
