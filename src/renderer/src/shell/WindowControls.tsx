import CaptionButtons, { TitlebarOverlaySpace } from '../components/CaptionButtons'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Badge, IconButton } from '../ui'
import { SidebarShow } from '../ui/icons'
import { overallPercent } from '../lib/downloads'
import { useShellLayout } from './layout'

const ACTIVE = ['downloading', 'processing', 'queued', 'paused', 'detecting']

/**
 * The window's caption controls for a header bar's `side`, per OS: GNOME's
 * round buttons on Linux in `button-layout` order, space for Windows'
 * caption overlay at the end, nothing on macOS (the traffic lights sit in the
 * sidebar's header). `where` says which header bar asks, so the start-side
 * buttons land in the left-most bar shown.
 */
export function WindowControls({ side, where }: { side: 'start' | 'end'; where: 'sidebar' | 'content' }): JSX.Element | null {
  const platform = useStore((s) => s.appInfo?.platform)
  const { pinned } = useShellLayout()
  if (platform === 'darwin') return null
  if (platform === 'win32') return side === 'end' && where === 'content' ? <TitlebarOverlaySpace /> : null
  // Linux: start-side buttons go in the sidebar header while it is pinned, else in the content header.
  if (side === 'start' && (where === 'sidebar') !== pinned) return null
  if (side === 'end' && where === 'sidebar') return null
  return <CaptionButtons side={side} />
}

/**
 * sidebar-show-symbolic, in the content header while the sidebar is an
 * overlay. It carries the Activity badge while the sidebar (and so the
 * Activity row's own badge) is hidden (A1.1).
 */
export function SidebarToggle(): JSX.Element | null {
  const t = useT()
  const { pinned } = useShellLayout()
  const open = useStore((s) => s.sidebarOverlayOpen)
  const setOpen = useStore((s) => s.setSidebarOverlayOpen)
  const active = useStore((s) => s.downloads.filter((d) => ACTIVE.includes(d.state)).length)
  const overall = useStore((s) => overallPercent(s.downloads))
  if (pinned) return null
  const badge = active > 0 ? (overall != null ? `${overall}%` : String(active)) : null
  return (
    <span className="inline-flex items-center gap-1">
      <IconButton
        label={t('shell.sidebar')}
        icon={<SidebarShow size={16} />}
        aria-pressed={open}
        aria-controls={open ? 'uvd-sidebar' : undefined}
        onClick={() => setOpen(!open)}
        data-uvd="sidebar-toggle"
      />
      {/* Beside the toggle, not over it: the glyph must stay readable. */}
      {badge && <Badge>{badge}</Badge>}
    </span>
  )
}
