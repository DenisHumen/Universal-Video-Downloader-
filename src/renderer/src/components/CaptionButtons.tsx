import { useEffect, useState } from 'react'
import type { CaptionButton } from '@shared/desktop'
import { DEFAULT_BUTTON_LAYOUT } from '@shared/desktop'
import { useT } from '../i18n'
import { useStore } from '../store'
import { WindowClose, WindowMaximize, WindowMinimize, WindowRestore } from '../ui/icons'
import Tooltip from '../ui/Tooltip'

/**
 * GNOME's caption buttons (A1, D5): 24 px circles at the text colour .10
 * (.15 hover, .25 pressed), each with a 36 px target, in the order the
 * desktop's `button-layout` gives (services/desktop.ts), on the side it puts
 * them. Linux only: Windows draws its own (titleBarOverlay, see
 * <TitlebarOverlaySpace>), macOS has traffic lights.
 */
export default function CaptionButtons({
  side = 'end',
  buttons
}: {
  side?: 'start' | 'end'
  /** Override the layout (tests, the browser and search windows). */
  buttons?: CaptionButton[]
}): JSX.Element | null {
  const t = useT()
  const layout = useStore((s) => s.appInfo?.buttonLayout) ?? DEFAULT_BUTTON_LAYOUT
  const platform = useStore((s) => s.appInfo?.platform)
  const order = buttons ?? layout[side]
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let live = true
    void window.api.isWindowMaximized().then((value) => live && setMaximized(value))
    // Double-click on the bar, Super+Up and tiling maximise without this button.
    const off = window.api.onMaximizedChange(setMaximized)
    return () => {
      live = false
      off()
    }
  }, [])

  // Windows draws its own (titleBarOverlay); macOS has its traffic lights.
  if (platform === 'win32') return side === 'end' ? <TitlebarOverlaySpace /> : null
  if (platform === 'darwin') return null
  if (!order.length) return null

  const one = (b: CaptionButton): JSX.Element => {
    if (b === 'minimize') {
      return (
        <Tooltip key={b} label={t('window.minimize')}>
          <button type="button" className="ui-caption no-drag" onClick={() => window.api.minimizeWindow()} aria-label={t('window.minimize')}>
            <span className="ui-caption-circle">
              <WindowMinimize size={16} />
            </span>
          </button>
        </Tooltip>
      )
    }
    if (b === 'maximize') {
      const label = maximized ? t('window.restore') : t('window.maximize')
      return (
        <Tooltip key={b} label={label}>
          <button
            type="button"
            className="ui-caption no-drag"
            // Some Linux window managers never report a maximise; follow the click there at least.
            onClick={async () => setMaximized(await window.api.maximizeWindow())}
            aria-label={label}
          >
            <span className="ui-caption-circle">{maximized ? <WindowRestore size={16} /> : <WindowMaximize size={16} />}</span>
          </button>
        </Tooltip>
      )
    }
    return (
      <Tooltip key={b} label={t('window.close')}>
        <button type="button" className="ui-caption no-drag" onClick={() => window.api.closeWindow()} aria-label={t('window.close')}>
          <span className="ui-caption-circle">
            <WindowClose size={16} />
          </span>
        </button>
      </Tooltip>
    )
  }

  return (
    <div className="flex shrink-0 items-center" data-uvd={`caption-${side}`}>
      {order.map(one)}
    </div>
  )
}

/**
 * Windows: the system draws the caption buttons over the top-right of the
 * window (titleBarOverlay); this keeps that corner of the header bar free,
 * as wide as the overlay says (env(titlebar-area-*)).
 */
export function TitlebarOverlaySpace(): JSX.Element {
  return <div className="ui-titlebar-overlay-space" data-uvd="caption-overlay" aria-hidden="true" />
}
