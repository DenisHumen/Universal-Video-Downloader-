import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useT } from '../i18n'

/*
  Full height and flush with the window's edge, 46px wide like the system's
  own. Inside a padded, centred group the buttons stopped short of the corner,
  so on a maximised window a pointer flung into the top-right corner landed on
  the drag region and the click did nothing.

  The focus outline is drawn inside the button: outside, it would be clipped
  by the window edge on the close button and by the bar's hairline below.
*/
const BASE =
  'no-drag inline-flex h-full w-[46px] cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/**
 * Minimise, maximise or restore, and close, for the windows that draw their own
 * title bar on Windows and Linux. macOS keeps its native traffic lights, so
 * callers render this only off the Mac.
 *
 * The three windows each had a copy, labelled in English whatever the app's
 * language, and the browser's and search window's maximise glyph never changed.
 */
export default function CaptionButtons(): JSX.Element {
  const t = useT()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let live = true
    void window.api.isWindowMaximized().then((value) => live && setMaximized(value))
    // Double-click on the bar, Win+Up and Snap maximise without this button.
    const off = window.api.onMaximizedChange(setMaximized)
    return () => {
      live = false
      off()
    }
  }, [])

  const maximizeLabel = maximized ? t('window.restore') : t('window.maximize')

  return (
    <div className="ml-1 flex shrink-0 self-stretch">
      <button
        type="button"
        className={`${BASE} hover:bg-sink hover:text-ink`}
        onClick={() => window.api.minimizeWindow()}
        aria-label={t('window.minimize')}
        title={t('window.minimize')}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        className={`${BASE} hover:bg-sink hover:text-ink`}
        /*
          The answer is still used, not only the event: some Linux window
          managers never report a maximise, and the glyph should follow the
          click there at least.
        */
        onClick={async () => setMaximized(await window.api.maximizeWindow())}
        aria-label={maximizeLabel}
        title={maximizeLabel}
      >
        {maximized ? <Copy size={12} /> : <Square size={11} />}
      </button>
      <button
        type="button"
        /*
          The system's own close red. White on the theme's `bad` is 2.69:1 in
          Night, too faint for the one glyph that ends the session; on this red
          it clears 5:1 in both themes.
        */
        className={`${BASE} hover:bg-[#C42B1C] hover:text-white`}
        onClick={() => window.api.closeWindow()}
        aria-label={t('window.close')}
        title={t('window.close')}
      >
        <X size={15} />
      </button>
    </div>
  )
}
