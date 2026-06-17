import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { useStore } from '../store'
import EngineBadge from './EngineBadge'
import Logo from './Logo'

export default function TitleBar(): JSX.Element {
  const appInfo = useStore((s) => s.appInfo)
  const isMac = appInfo?.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.isWindowMaximized().then(setMaximized)
  }, [])

  const onMaximize = async (): Promise<void> => {
    const m = await window.api.maximizeWindow()
    setMaximized(m)
  }

  return (
    <header
      className="drag-region relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-base-900/40 backdrop-blur-xl"
      style={{ paddingLeft: isMac ? 84 : 16, paddingRight: 8 }}
    >
      <div className="flex items-center gap-2.5">
        <Logo className="h-6 w-6" />
        <span className="text-[13px] font-semibold tracking-wide text-white/90">
          Universal Video Downloader
        </span>
        {appInfo && (
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/40">
            v{appInfo.version}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <EngineBadge />
        {!isMac && (
          <div className="ml-1 flex items-center gap-1">
            <button className="btn-icon" onClick={() => window.api.minimizeWindow()} aria-label="Minimize">
              <Minus size={16} />
            </button>
            <button className="btn-icon" onClick={onMaximize} aria-label="Maximize">
              {maximized ? <Copy size={14} /> : <Square size={13} />}
            </button>
            <button
              className="no-drag inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-all hover:bg-red-500/80 hover:text-white active:scale-95"
              onClick={() => window.api.closeWindow()}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
