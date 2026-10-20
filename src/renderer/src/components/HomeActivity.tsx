import { ArrowRight, FolderOpen, Play } from 'lucide-react'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'
import { formatSpeed } from '../lib/format'
import { liveDownloads, recentFinished } from '../lib/downloads'
import { STATE_META } from '../lib/states'
import { toast } from '../lib/toast'

/**
 * Home's idle state once something has been downloaded: what is moving now,
 * and what just finished.
 *
 * The capability list is an introduction, and on the hundredth visit it was
 * the same introduction - while the thing a returning user wants from this
 * screen, besides the field, is "is my download still going" and "open what I
 * just got", both one screen away. First run keeps the list; see HomeView.
 */
export default function HomeActivity(): JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const setView = useStore((s) => s.setView)
  const live = liveDownloads(downloads)
  const recent = recentFinished(downloads)

  return (
    <div className="space-y-6">
      {live.length > 0 && (
        <section>
          <p className="label mb-2">{t('home.active')}</p>
          <ul className="divide-y divide-edge border-y border-edge">
            {live.map((item) => (
              <LiveRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <p className="label mb-2">{t('home.recent')}</p>
          <ul className="divide-y divide-edge border-y border-edge">
            {recent.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={item.title}>
                  {item.title}
                </span>
                {item.filepath && (
                  <>
                    <button
                      className="btn-icon-bare"
                      title={t('common.play')}
                      aria-label={`${t('common.play')}: ${item.title}`}
                      onClick={() =>
                        void window.api.openPath(item.filepath!).then((why) => {
                          if (why) toast(t('queue.openFailed'), 'error')
                        })
                      }
                    >
                      <Play size={14} />
                    </button>
                    <button
                      className="btn-icon-bare"
                      title={t('common.showInFolder')}
                      aria-label={`${t('common.showInFolder')}: ${item.title}`}
                      onClick={() => window.api.showInFolder(item.filepath!)}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="btn-quiet" onClick={() => setView('downloads')}>
        {t('home.openQueue')} <ArrowRight size={14} />
      </button>
    </div>
  )
}

/** One running job: its state, how far along, how fast - and a hairline of progress. */
function LiveRow({ item }: { item: DownloadItem }): JSX.Element {
  const t = useT()
  const meta = STATE_META[item.state]
  const percent = Math.round(item.percent || 0)
  const facts = [
    t(meta.label),
    item.state === 'downloading' && !item.indeterminate ? `${percent}%` : null,
    item.speed ? formatSpeed(item.speed) : null
  ].filter(Boolean)
  return (
    <li className="relative py-2">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={item.title}>
          {item.title}
        </span>
        <span className="mono shrink-0 text-[12px] text-ink-2">{facts.join(' · ')}</span>
      </div>
      {item.state !== 'queued' && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-edge" aria-hidden="true">
          <div
            className="h-full bg-accent transition-[width] duration-base ease-ease"
            style={{ width: `${item.indeterminate ? 0 : percent}%` }}
          />
        </div>
      )}
    </li>
  )
}
