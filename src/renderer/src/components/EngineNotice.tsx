import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * What is happening to the download engine, on the rare occasions it matters.
 *
 * The app ships without yt-dlp and fetches it on first launch — around 30MB.
 * Every detection awaits that download, so the first thing a new user does
 * (paste a link, press the button) sits there for up to a minute while the only
 * hint is a small badge in the corner of the title bar. That reads as a hang,
 * and it happens at the exact moment someone decides whether to keep the app.
 *
 * Silent once the engine is ready: a strip that is always on screen is chrome,
 * not information. Only the first-run download and an outright failure show.
 *
 * No exit animation, and no `AnimatePresence`. What makes this strip go away is
 * an external event — the engine finishing — rather than a click, which is
 * exactly the case that breaks when the frame clock stalls: measured with
 * animations frozen, it went on announcing "getting the download engine ready"
 * long after the engine was ready. It appears and disappears on state, and only
 * the appearing is animated, in CSS.
 */
export default function EngineNotice(): JSX.Element | null {
  const t = useT()
  const ytdlp = useStore((s) => s.ytdlp)
  const [retrying, setRetrying] = useState(false)

  const downloading = ytdlp.state === 'downloading'
  const failed = ytdlp.state === 'error'
  const percent = Math.round(ytdlp.percent ?? 0)

  const retry = async (): Promise<void> => {
    setRetrying(true)
    try {
      useStore.setState({ ytdlp: await window.api.ensureYtdlp() })
    } finally {
      setRetrying(false)
    }
  }

  if (!downloading && !failed) return null

  return (
    <div className="animate-rise shrink-0 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
        <span className={`label shrink-0 ${failed ? 'text-bad' : 'text-accent-ink'}`}>
          {t('engine.setupLabel')}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">
            {failed ? t('engine.setupFailed') : t('engine.setupTitle')}
          </p>
          {failed ? (
            <p className="mono truncate text-[12px] text-ink-2" title={ytdlp.message}>
              {ytdlp.message}
            </p>
          ) : (
            <div className="mt-1.5 flex items-center gap-3">
              <div
                className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-sink"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('engine.setupTitle')}
              >
                {/* A plain style, like every other bar in the app. This one runs
                    before the window has even been touched, which is when the
                    frame clock is least reliable. */}
                <div
                  className="h-full bg-accent transition-[width] duration-base ease-ease"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="mono shrink-0 text-[12px] tabular-nums text-ink-2">{percent}%</span>
            </div>
          )}
        </div>

        {failed ? (
          <button className="btn-solid shrink-0 px-3 py-2" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('common.retry')}
          </button>
        ) : (
          <span className="mono hidden shrink-0 text-[12px] text-ink-3 sm:inline">
            {t('engine.setupOnce')}
          </span>
        )}
      </div>
    </div>
  )
}
