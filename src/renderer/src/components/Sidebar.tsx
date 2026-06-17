import { motion } from 'framer-motion'
import { Download, ListVideo, Settings as SettingsIcon } from 'lucide-react'
import { useStore, type ViewId } from '../store'
import Logo from './Logo'

interface NavItem {
  id: ViewId
  label: string
  icon: JSX.Element
}

const items: NavItem[] = [
  { id: 'home', label: 'download', icon: <Download size={18} /> },
  { id: 'downloads', label: 'queue', icon: <ListVideo size={18} /> },
  { id: 'settings', label: 'settings', icon: <SettingsIcon size={18} /> }
]

export default function Sidebar(): JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const downloads = useStore((s) => s.downloads)
  const active = downloads.filter((d) =>
    ['downloading', 'processing', 'queued', 'paused'].includes(d.state)
  ).length

  return (
    <nav className="z-20 flex w-[208px] shrink-0 flex-col gap-1.5 p-3">
      <div className="mb-3 flex items-center gap-2.5 px-3 pt-1">
        <Logo className="h-7 w-7" />
        <span className="mono text-[15px] font-semibold tracking-tight text-cream">downloader</span>
      </div>

      {items.map((item) => {
        const isActive = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className="no-drag group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left"
          >
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-2xl bg-cream"
                transition={{ type: 'spring', stiffness: 480, damping: 40 }}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                isActive ? 'text-ink-950' : 'text-white/55 group-hover:text-cream'
              }`}
            >
              {item.icon}
            </span>
            <span
              className={`relative z-10 text-sm font-medium transition-colors ${
                isActive ? 'text-ink-950' : 'text-white/55 group-hover:text-cream'
              }`}
            >
              {item.label}
            </span>
            {item.id === 'downloads' && active > 0 && (
              <span
                className={`relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  isActive ? 'bg-ink-950/15 text-ink-950' : 'bg-white/10 text-cream'
                }`}
              >
                {active}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto px-3 pb-1">
        <button
          onClick={() =>
            window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
          }
          className="no-drag mono text-[11px] text-white/30 transition-colors hover:text-white/60"
        >
          open source · github
        </button>
      </div>
    </nav>
  )
}
