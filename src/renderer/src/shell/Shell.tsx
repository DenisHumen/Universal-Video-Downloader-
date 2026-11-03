import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { useStore, type ViewId } from '../store'
import { useT } from '../i18n'
import { HeaderBar } from '../ui'
import Sidebar from './Sidebar'
import { NAV_ALL } from './nav'
import { SidebarToggle, WindowControls } from './WindowControls'
import { SIDEBAR_PINNED_FROM, useShellLayout } from './layout'

interface Props {
  /** From the preload (appInfo.platform), so tests can render the shell as any OS. */
  platform: NodeJS.Platform | undefined
  /** Full-width banners under the content header: engine setup, update, notices. */
  notices?: ReactNode
  children: ReactNode
}

/** Kept for callers of the 4.0 shell. */
export const RAIL_BELOW = SIDEBAR_PINNED_FROM

/** Views that draw their own header bars (Settings has two panes, each with one). */
const OWN_HEADER: ViewId[] = ['settings']

/**
 * The window (A1.1 + the user's GNOME Settings reference): the v4 inset sheet
 * (--surface, 12 px top-left corner, --sheet-edge) beside a GNOME sidebar on
 * --sidebar. Each pane has its own 46 px header bar: the sidebar's carries
 * the app name and primary menu, the content's the section title, centred,
 * with the sidebar toggle at the start when the sidebar is an overlay, and
 * the caption buttons at the end.
 *
 * Below 860 px (or while Settings folds it, 860-1099) the sidebar is an
 * overlay over the sheet with a scrim; Esc or a click outside closes it.
 * There is never a double rail and never an icon rail (A1.1).
 *
 * Window chrome on every OS (tests in shell.test.tsx): both header bars are
 * drag regions with no-drag controls; Linux draws GNOME's round caption
 * buttons in button-layout order, Windows reserves room for its caption
 * overlay, macOS keeps the traffic lights in the sidebar header.
 */
export default function Shell({ platform, notices, children }: Props): JSX.Element {
  const t = useT()
  const view = useStore((s) => s.view)
  const { pinned } = useShellLayout()
  const overlayOpen = useStore((s) => s.sidebarOverlayOpen)
  const setOverlayOpen = useStore((s) => s.setSidebarOverlayOpen)
  const [scrolled, setScrolled] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)

  // The header's shade shows once the content under it has scrolled (AdwHeaderBar).
  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target !== sheet.current) setScrolled(target.scrollTop > 0)
  }
  useEffect(() => setScrolled(false), [view])

  useEffect(() => {
    if (pinned || !overlayOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOverlayOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pinned, overlayOpen, setOverlayOpen])

  const section = NAV_ALL.find((s) => s.id === view)
  const ownHeader = OWN_HEADER.includes(view)

  return (
    <div className="relative flex min-h-0 flex-1">
      {(pinned || overlayOpen) && <Sidebar platform={platform} overlay={!pinned} />}
      {!pinned && overlayOpen && (
        <div className="scrim absolute inset-0" style={{ zIndex: 'var(--z-chrome)' }} onClick={() => setOverlayOpen(false)} aria-hidden="true" />
      )}
      <div
        ref={sheet}
        className={`app-sheet relative flex min-w-0 flex-1 flex-col overflow-hidden bg-raise ${pinned ? 'rounded-tl-3' : ''}`}
        onScrollCapture={onScroll}
      >
        {!ownHeader && (
          <HeaderBar
            data-uvd="sheet-drag"
            shade={scrolled}
            title={section ? t(section.label) : undefined}
            start={
              <>
                <WindowControls side="start" where="content" />
                <SidebarToggle />
              </>
            }
            end={<WindowControls side="end" where="content" />}
          />
        )}
        {notices}
        {children}
      </div>
    </div>
  )
}
