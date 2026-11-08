import { ArrowRight, FolderOpen, Play } from '../ui/icons'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'
import { formatSpeed } from '../lib/format'
import { liveDownloads, recentFailed, recentFinished } from '../lib/downloads'
import { errorText } from '../lib/errors'
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
  const failed = recentFailed(downloads)

  return (
    <div className="space-y-6">
      {live.length > 0 && (
        <section>
          <h3 className="mb-3 text-heading text-ink">{t('home.active')}</h3>
          <ul className="ui-boxed-list">
            {live.map((item) => (
              <LiveRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {/*
        A failed row used to leave this screen without a word: it had gone from
        "now", it never reached "finished", and with notifications off nothing
        else said so. To the person watching, it looked as if nothing happened.
      */}
      {failed.length > 0 && (
        <section>
          <h3 className="mb-3 text-heading text-ink">{t('home.failed')}</h3>
          <ul className="ui-boxed-list">
            {failed.map((item) => (
              <li key={item.id} className="ui-row min-h-[50px]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-control text-ink" title={item.title}>
                    {item.title}
                  </span>
                  <span className="line-clamp-2 text-meta text-ink-2">{errorText(t, item)}</span>
                </span>
                <button className="btn-quiet shrink-0" onClick={() => setView('downloads')}>
                  {t('home.whatToDo')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h3 className="mb-3 text-heading text-ink">{t('home.recent')}</h3>
          <ul className="ui-boxed-list">
            {recent.map((item) => (
              <li key={item.id} className="ui-row min-h-[50px]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-control text-ink" title={item.title}>
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
    <li className="ui-row min-h-[50px] flex-wrap">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-control text-ink" title={item.title}>
          {item.title}
        </span>
        <span className="numeric shrink-0 text-meta text-ink-2">{facts.join(' · ')}</span>
      </div>
      {item.state !== 'queued' && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-edge" aria-hidden="true">
          <div
            className="h-full bg-accent-bright transition-[width] duration-base ease-ease"
            style={{ width: `${item.indeterminate ? 0 : percent}%` }}
          />
        </div>
      )}
    </li>
  )
}
