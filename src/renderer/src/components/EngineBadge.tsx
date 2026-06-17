import { motion } from 'framer-motion'
import { useStore } from '../store'

export default function EngineBadge(): JSX.Element {
  const ytdlp = useStore((s) => s.ytdlp)

  const color =
    ytdlp.state === 'ready' ? '#7ee0a8' : ytdlp.state === 'error' ? '#f0857d' : '#e0c97e'

  const label =
    ytdlp.state === 'ready'
      ? 'engine ready'
      : ytdlp.state === 'downloading'
        ? `engine ${ytdlp.percent ?? 0}%`
        : ytdlp.state === 'checking'
          ? 'engine…'
          : ytdlp.state === 'error'
            ? 'engine error'
            : 'engine'

  const pulsing = ytdlp.state === 'checking' || ytdlp.state === 'downloading'

  return (
    <div
      className="no-drag flex items-center gap-2 rounded-full bg-white/[0.04] px-2.5 py-1"
      title={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || label}
    >
      <motion.span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
        animate={pulsing ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: pulsing ? Infinity : 0 }}
      />
      <span className="mono text-[11px] font-medium text-white/45">{label}</span>
    </div>
  )
}
