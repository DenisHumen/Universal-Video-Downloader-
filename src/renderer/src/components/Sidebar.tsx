import { motion } from 'framer-motion'
import { pill } from '../lib/motion'
import { Download, Keyboard, ListVideo, Search, Settings as SettingsIcon } from 'lucide-react'
import { useStore, type ViewId } from '../store'
import { useT, type TranslationKey } from '../i18n'
import Logo from './Logo'

interface NavItem {
  id: ViewId
  label: TranslationKey
  icon: JSX.Element
  hint: string
}

const items: NavItem[] = [
  { id: 'home', label: 'nav.home', icon: <Download size={18} />, hint: '1' },
  { id: 'search', label: 'nav.search', icon: <Search size={18} />, hint: '2' },
  { id: 'downloads', label: 'nav.queue', icon: <ListVideo size={18} />, hint: '3' },
  { id: 'settings', label: 'nav.settings', icon: <SettingsIcon size={18} />, hint: '4' }
]

export default function Sidebar(): JSX.Element {
  const t = useT()
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const downloads = useStore((s) => s.downloads)
  const openShortcuts = useStore((s) => s.setShortcutsOpen)
  const active = downloads.filter((d) =>
    ['downloading', 'processing', 'queued', 'paused', 'detecting'].includes(d.state)
  ).length

  return (
    <nav
      className="z-[var(--z-nav)] flex w-[212px] shrink-0 flex-col gap-1 p-3"
      style={{ zIndex: 'var(--z-nav)' }}
    >
      <div className="mb-4 flex items-center gap-2.5 px-3 pt-1">
        <Logo className="h-7 w-7" />
        <span className="text-[15px] font-semibold tracking-tight text-cream">downloader</span>
      </div>

      {items.map((item) => {
        const isActive = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={`${t(item.label)} · Ctrl/⌘ ${item.hint}`}
            aria-current={isActive ? 'page' : undefined}
            className="no-drag group relative flex cursor-pointer items-center gap-3 rounded-control px-3.5 py-2.5 text-left transition-colors duration-200 ease-expo hover:bg-fg/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-control bg-accent shadow-accent-sm"
                transition={pill}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                isActive ? 'text-accent-fg' : 'text-fg/70 group-hover:text-cream'
              }`}
            >
              {item.icon}
            </span>
            <span
              className={`relative z-10 text-sm font-medium transition-colors ${
                isActive ? 'text-accent-fg' : 'text-fg/70 group-hover:text-cream'
              }`}
            >
              {t(item.label)}
            </span>
            {item.id === 'downloads' && active > 0 && (
              <span
                className={`relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  isActive ? 'bg-accent-fg/15 text-accent-fg' : 'bg-fg/10 text-cream'
                }`}
              >
                {active}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto space-y-2 px-3 pb-1">
        <button
          onClick={() => openShortcuts(true)}
          className="no-drag mono flex items-center gap-1.5 text-[11px] text-fg/50 transition-colors hover:text-fg/60"
        >
          <Keyboard size={13} /> {t('shortcuts.open')}
        </button>
        <button
          onClick={() =>
            window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
          }
          className="no-drag mono block text-[11px] text-fg/50 transition-colors hover:text-fg/60"
        >
          {t('nav.github')}
        </button>
      </div>
    </nav>
  )
}
