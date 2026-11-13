import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { overallPercent } from '../lib/downloads'
import { Badge, HeaderBar, IconButton, Menu, Tooltip, cx } from '../ui'
import { OpenMenu, Help } from '../ui/icons'
import { NAV_BOTTOM, NAV_MAIN, type NavSection } from './nav'
import { WindowControls } from './WindowControls'

const ACTIVE_STATES = ['downloading', 'processing', 'queued', 'paused', 'detecting', 'waiting']

interface Props {
  /** The platform, from the preload (appInfo), never `process.platform`: tests render it as each OS. */
  platform: NodeJS.Platform | undefined
  /** An overlay (below 860 px, or folded by Settings) rather than pinned beside the content. */
  overlay: boolean
}

/**
 * The app sidebar, as GNOME Settings' (A1.1 + the user's reference): the
 * `--sidebar` plane, a header bar (app name centred, primary menu at the
 * end; on macOS the traffic lights' space at the start; on Linux any
 * start-side caption buttons), 44 px rows of a 16 px symbolic icon and a
 * label, selected with a neutral .10 fill (never the accent), and thin
 * separators between groups. The Activity row carries the queue badge.
 *
 * The 3.x/4.0 footer is gone: engine state is a banner when the engine is
 * not ready, language is in Settings › Appearance, and shortcuts and the
 * built-in browser are in the primary menu.
 */
export default function Sidebar({ platform, overlay }: Props): JSX.Element {
  const t = useT()
  const isMac = platform === 'darwin'
  const openShortcuts = useStore((s) => s.setShortcutsOpen)
  const openSettings = useStore((s) => s.openSettings)
  const navRef = useRef<HTMLElement>(null)

  // The toggle stays behind the scrim, and after it in the tab order: Tab would have gone on through the dimmed page.
  useEffect(() => {
    if (overlay) navRef.current?.querySelector('button')?.focus({ preventScroll: true })
  }, [overlay])

  return (
    <div
      id="uvd-sidebar"
      className={cx('ui-app-sidebar flex w-[240px] shrink-0 flex-col', overlay && 'ui-app-sidebar-overlay')}
      /*
        Above its scrim (--z-chrome) as an overlay. It was under it, so in a window
        narrower than 860 px every click on the only navigation there is landed on
        the scrim and just closed the sidebar. Only a real pointer can tell.
      */
      style={{ zIndex: overlay ? 'var(--z-banner)' : 'var(--z-nav)' }}
      data-overlay={overlay || undefined}
    >
      <HeaderBar
        data-uvd="sidebar-drag"
        heading={false}
        title={<span className="font-bold">UVD</span>}
        start={isMac ? <span className="w-[60px]" aria-hidden="true" /> : <WindowControls side="start" where="sidebar" />}
        end={
          <Menu
            label={t('shell.mainMenu')}
            items={[
              { label: t('palette.title'), onSelect: () => useStore.getState().setPaletteOpen(true) },
              { label: t('shortcuts.title'), onSelect: () => openShortcuts(true) },
              { label: t('browser.open'), onSelect: () => void window.api.openBrowser() },
              { label: t('setup.menu'), onSelect: () => useStore.getState().setSetupOpen(true) },
              'separator',
              { label: t('help.title'), onSelect: () => useStore.getState().openHelp() },
              { label: t('shell.about'), onSelect: () => openSettings('system/about') }
            ]}
            trigger={(p) => <IconButton {...p} label={t('shell.mainMenu')} icon={<OpenMenu size={16} />} />}
          />
        }
      />

      <nav ref={navRef} aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
        {NAV_MAIN.map((s) => (
          <NavItem key={s.id} section={s} />
        ))}
        <div className="mx-1.5 my-1.5 h-px shrink-0 bg-fill/15" role="separator" />
        {/* In plain sight: someone who is lost will not think to look behind the menu button. */}
        <NavItem section={{ id: 'guide', label: 'help.title', icon: Help, key: '' }} />
        {NAV_BOTTOM.map((s) => (
          <NavItem key={s.id} section={s} />
        ))}
      </nav>
    </div>
  )
}

function NavItem({ section }: { section: NavSection }): JSX.Element {
  const t = useT()
  const on = useStore((s) => s.view === section.id)
  const setView = useStore((s) => s.setView)
  /*
    Counts, not lists: the downloads array changes on every progress line, and
    the sidebar should redraw when a number it shows changes, not per tick.
  */
  const active = useStore((s) =>
    section.id === 'downloads' ? s.downloads.filter((d) => ACTIVE_STATES.includes(d.state)).length : 0
  )
  const overall = useStore((s) => (section.id === 'downloads' ? overallPercent(s.downloads) : null))
  const failed = useStore((s) => (section.id === 'downloads' ? s.downloads.filter((d) => d.state === 'error').length : 0))
  const alerts = useStore((s) => (section.id === 'automation' ? s.watchAlerts : 0))
  const unseen = useStore((s) => (section.id === 'library' ? s.libraryUnseen : 0))
  const label = t(section.label)

  const button = (
    <button
      type="button"
      onClick={() => setView(section.id)}
      aria-current={on ? 'page' : undefined}
      className={cx('ui-nav-item no-drag relative flex h-9 w-full shrink-0 items-center gap-3 rounded-1 px-2 text-body', on && 'ui-nav-item-on')}
    >
      <section.icon size={16} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {active > 0 && <Badge>{overall != null ? `${overall}%` : active}</Badge>}
      {unseen > 0 && <Badge label={t('library.unseen', { n: String(unseen) })}>{unseen}</Badge>}
      {failed > 0 && active === 0 && (
        <span
          className="h-2 w-2 rounded-pill bg-bad"
          role="img"
          aria-label={t('queue.failedCount', { n: String(failed) })}
        />
      )}
      {alerts > 0 && (
        <span
          className="h-2 w-2 rounded-pill bg-bad"
          role="img"
          aria-label={t('auto.failingCount', { n: String(alerts) })}
        />
      )}
    </button>
  )
  // Ellipsis + tooltip is the last resort for a long label (ru at 240 px).
  return label.length > 22 ? <Tooltip label={label} side="right">{button}</Tooltip> : button
}
