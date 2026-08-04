import { useEffect, useState } from 'react'
import {
  Copy,
  Download,
  Globe,
  Keyboard,
  ListVideo,
  Minus,
  Search,
  Settings as SettingsIcon,
  Square,
  X
} from 'lucide-react'
import { useStore, type ViewId } from '../store'
import { useT, type TranslationKey } from '../i18n'
import Logo from './Logo'
import EngineBadge from './EngineBadge'

interface NavItem {
  id: ViewId
  label: TranslationKey
  icon: JSX.Element
  hint: string
}

/**
 * Navigation: icon plus label, marked by a rule on the bar's own bottom
 * hairline so the indicator is part of the window's structure.
 *
 * The icons were dropped at first on the theory that four words don't need
 * them. They do: a glyph is recognised before it is read, which is what lets
 * someone find "queue" at a glance instead of parsing a row of same-sized
 * lowercase words.
 */
const ITEMS: NavItem[] = [
  { id: 'home', label: 'nav.home', icon: <Download size={15} />, hint: '1' },
  { id: 'search', label: 'nav.search', icon: <Search size={15} />, hint: '2' },
  { id: 'downloads', label: 'nav.queue', icon: <ListVideo size={15} />, hint: '3' },
  { id: 'settings', label: 'nav.settings', icon: <SettingsIcon size={15} />, hint: '4' }
]

const ACTIVE_STATES = ['downloading', 'processing', 'queued', 'paused', 'detecting']

/**
 * The window's single piece of chrome: identity, navigation, engine state and
 * the platform's window controls, all on one 48px rule.
 *
 * The previous build split these across a title bar and a 212px sidebar, which
 * spent a seventh of the window on four labels that never change.
 */
export default function TopBar(): JSX.Element {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const downloads = useStore((s) => s.downloads)
  const openShortcuts = useStore((s) => s.setShortcutsOpen)
  const isMac = appInfo?.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.isWindowMaximized().then(setMaximized)
  }, [])

  const onMaximize = async (): Promise<void> => {
    setMaximized(await window.api.maximizeWindow())
  }

  const active = downloads.filter((d) => ACTIVE_STATES.includes(d.state)).length

  return (
    <header
      className="drag-region relative flex h-12 shrink-0 items-stretch justify-between border-b border-edge bg-canvas"
      style={{ zIndex: 'var(--z-chrome)', paddingLeft: isMac ? 76 : 0 }}
    >
      <div className="flex min-w-0 items-stretch">
        <div className="flex shrink-0 items-center gap-2.5 pl-4 pr-5">
          <Logo className="h-[18px] w-[18px] text-ink" />
          <span className="mono hidden text-[12px] font-semibold uppercase tracking-[0.16em] text-ink sm:inline">
            uvd
          </span>
        </div>

        <nav className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
          {ITEMS.map((item) => {
            const on = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                title={`${t(item.label)} · Ctrl/⌘ ${item.hint}`}
                aria-current={on ? 'page' : undefined}
                className={`tab -mb-px ${on ? 'tab-on' : ''}`}
              >
                {item.icon}
                {t(item.label)}
                {item.id === 'downloads' && active > 0 && (
                  <span
                    className={`mono rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                      on ? 'bg-accent text-accent-fg' : 'bg-sink text-ink-2'
                    }`}
                  >
                    {active}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-3 pr-2">
        <EngineBadge />
        <button
          className="btn-icon-bare"
          title={t('browser.open')} aria-label={t('browser.open')}
          onClick={() => window.api.openBrowser()}
        >
          <Globe size={15} />
        </button>
        <button className="btn-icon-bare" title={t('shortcuts.title')} aria-label={t('shortcuts.title')} onClick={() => openShortcuts(true)}>
          <Keyboard size={15} />
        </button>

        {!isMac && (
          <div className="ml-1 flex items-center">
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink"
              onClick={() => window.api.minimizeWindow()}
              aria-label="Minimize"
            >
              <Minus size={15} />
            </button>
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink"
              onClick={onMaximize}
              aria-label="Maximize"
            >
              {maximized ? <Copy size={12} /> : <Square size={11} />}
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
      </div>
    </header>
  )
}
