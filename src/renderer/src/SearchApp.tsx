import { useEffect, useState } from 'react'
import { Minus, X } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import AuroraBackground from './components/AuroraBackground'
import Logo from './components/Logo'
import Toasts from './components/Toasts'
import SearchView from './views/SearchView'

/** Shell for the dedicated title-search window. */
export default function SearchApp(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.getAppInfo().then((info) => setIsMac(info.platform === 'darwin'))
  }, [])

  return (
    <>
      <AuroraBackground />
      <Toasts />

      <header
        className="drag-region relative z-30 flex h-11 shrink-0 items-center justify-between"
        style={{ paddingLeft: isMac ? 80 : 14, paddingRight: 10 }}
      >
        <div className="flex items-center gap-2.5">
          <Logo className="h-6 w-6" />
          <span className="mono text-[13px] font-semibold tracking-tight text-cream">search</span>
        </div>
        {!isMac && (
          <div className="flex items-center gap-1">
            <button className="btn-icon" onClick={() => window.api.minimizeWindow()} aria-label="Minimize">
              <Minus size={16} />
            </button>
            <button
              className="no-drag inline-flex h-9 w-9 items-center justify-center rounded-xl text-white/55 transition-all hover:bg-red-500/80 hover:text-white active:scale-95"
              onClick={() => window.api.closeWindow()}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 px-3 pb-3">
        <main className="panel min-h-0 flex-1 overflow-hidden shadow-panel">
          <div className="h-full overflow-y-auto">
            <SearchView settings={settings} />
          </div>
        </main>
      </div>
    </>
  )
}
