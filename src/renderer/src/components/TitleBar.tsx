import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { useStore } from '../store'
import EngineBadge from './EngineBadge'

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
      className="drag-region relative z-30 flex h-11 shrink-0 items-center justify-between"
      style={{ paddingLeft: isMac ? 80 : 14, paddingRight: 10 }}
    >
      <div className="flex items-center gap-2">
        {appInfo && (
          <span className="mono rounded-lg bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/35">
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
              {maximized ? <Copy size={13} /> : <Square size={12} />}
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
      </div>
    </header>
  )
}
