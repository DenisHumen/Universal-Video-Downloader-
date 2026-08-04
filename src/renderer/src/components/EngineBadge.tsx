import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * Engine state as a status dot plus a mono label — no pill, no container.
 *
 * The dot is the whole signal; the label only exists because a colour alone
 * can't say *what* is ready, and colour-only status fails for anyone who can't
 * separate the hues. It stays out of the way at tertiary weight and never
 * animates unless something is genuinely in flight.
 */
export default function EngineBadge(): JSX.Element {
  const t = useT()
  const ytdlp = useStore((s) => s.ytdlp)

  const tone =
    ytdlp.state === 'ready' ? 'bg-good' : ytdlp.state === 'error' ? 'bg-bad' : 'bg-warn'

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

  const busy = ytdlp.state === 'checking' || ytdlp.state === 'downloading'

  return (
    <div
      className="no-drag mr-1 hidden items-center gap-2 md:flex"
      title={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone} ${busy ? 'animate-idle-pulse' : ''}`} />
      <span className="mono text-[11px] uppercase tracking-[0.08em] text-ink-2">{label}</span>
    </div>
  )
}
