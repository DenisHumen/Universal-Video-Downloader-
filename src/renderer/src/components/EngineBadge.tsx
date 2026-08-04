import { motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../i18n'

export default function EngineBadge(): JSX.Element {
  const t = useT()
  const ytdlp = useStore((s) => s.ytdlp)

  const color =
    ytdlp.state === 'ready'
      ? 'rgb(var(--good))'
      : ytdlp.state === 'error'
        ? 'rgb(var(--bad))'
        : 'rgb(var(--warn))'

  const label =
    ytdlp.state === 'ready'
      ? t('engine.ready')
      : ytdlp.state === 'downloading'
        ? t('engine.downloading', { percent: ytdlp.percent ?? 0 })
        : ytdlp.state === 'checking'
          ? t('engine.checking')
          : ytdlp.state === 'error'
            ? t('engine.error')
            : t('engine.idle')

  const pulsing = ytdlp.state === 'checking' || ytdlp.state === 'downloading'

  return (
    <div
      className="no-drag flex items-center gap-2 rounded-full bg-fg/[0.04] px-2.5 py-1"
      title={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || label}
    >
      <motion.span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
        animate={pulsing ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: pulsing ? Infinity : 0 }}
      />
      <span className="mono text-[11px] font-medium text-fg/45">{label}</span>
    </div>
  )
}
