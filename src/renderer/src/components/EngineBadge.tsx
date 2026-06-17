import { motion } from 'framer-motion'
import { useStore } from '../store'

export default function EngineBadge(): JSX.Element {
  const ytdlp = useStore((s) => s.ytdlp)

  const color =
    ytdlp.state === 'ready'
      ? '#34d399'
      : ytdlp.state === 'error'
        ? '#f87171'
        : '#fbbf24'

  const label =
    ytdlp.state === 'ready'
      ? 'Engine ready'
      : ytdlp.state === 'downloading'
        ? `Engine ${ytdlp.percent ?? 0}%`
        : ytdlp.state === 'checking'
          ? 'Engine…'
          : ytdlp.state === 'error'
            ? 'Engine error'
            : 'Engine'

  const pulsing = ytdlp.state === 'checking' || ytdlp.state === 'downloading'

  return (
    <div
      className="no-drag flex items-center gap-2 rounded-full bg-white/5 px-2.5 py-1"
      title={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || label}
    >
      <motion.span
        className="h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${color}` }}
        animate={pulsing ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: pulsing ? Infinity : 0 }}
      />
      <span className="text-[11px] font-medium text-white/55">{label}</span>
    </div>
  )
}
