import { motion } from 'framer-motion'
import { Download, ListVideo, Settings as SettingsIcon } from 'lucide-react'
import { useStore, type ViewId } from '../store'

interface NavItem {
  id: ViewId
  label: string
  icon: JSX.Element
}

const items: NavItem[] = [
  { id: 'home', label: 'Download', icon: <Download size={20} /> },
  { id: 'downloads', label: 'Queue', icon: <ListVideo size={20} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} /> }
]

export default function Sidebar(): JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const downloads = useStore((s) => s.downloads)
  const active = downloads.filter((d) =>
    ['downloading', 'processing', 'queued', 'paused'].includes(d.state)
  ).length

  return (
    <nav className="z-20 flex w-20 shrink-0 flex-col items-center gap-2 border-r border-white/5 bg-base-900/30 py-5 backdrop-blur-xl">
      {items.map((item) => {
        const isActive = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className="group relative flex w-full flex-col items-center gap-1.5 py-2"
          >
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-accent-500 shadow-glow"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span
              className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-accent-500/15 text-accent-300 shadow-glow'
                  : 'text-white/45 group-hover:bg-white/5 group-hover:text-white/80'
              }`}
            >
              {item.icon}
              {item.id === 'downloads' && active > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[9px] font-bold text-base-950">
                  {active}
                </span>
              )}
            </span>
            <span
              className={`text-[10px] font-medium transition-colors ${
                isActive ? 'text-white/80' : 'text-white/35 group-hover:text-white/60'
              }`}
            >
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
