import { useSyncExternalStore } from 'react'
import { cookieBrowsersFor, type AppErrorCode } from '@shared/types'
import { ChannelSecure, Clock, Copy, Folder, Globe, Multimedia, Send } from '../ui/icons'
import { Menu } from '../ui'
import { useT } from '../i18n'
import { useStore } from '../store'
import { toast } from '../lib/toast'
import { FIX_LABEL, fixFor, retryAt, scheduleRetry, subscribeRetries } from '../lib/fixes'

export interface FixBarProps {
  errorCode?: AppErrorCode
  cookieHint?: boolean
  /** The page, for "Open in Built-in Browser". */
  url: string
  /** Try again as it was (after cookies are set, or once the wait is over). */
  onRetry: () => void
  /** Try again as audio only. */
  onAudioOnly: () => void
  /** Try again into another folder. */
  onChangeFolder: (dir: string) => void
  /** It has not started: queue it to wait for that. */
  onWaitForVideo: () => void
  /** Keys the five-minute wait, so a second click does not stack. */
  retryKey: string
  /** What Copy Error puts on the clipboard. */
  copyText: string
  /** The report offer, when there is one for this failure. */
  report?: { open: boolean; onToggle: () => void }
}

const browserLabel = (b: string): string => b.charAt(0).toUpperCase() + b.slice(1)

/**
 * The buttons a failure offers (6.2): the fix its error code calls for, then
 * Report (when main kept the failure for one) and Copy Error. The report
 * itself stays a question: nothing is sent until its own Send is pressed.
 */
export default function FixBar({
  errorCode,
  cookieHint,
  url,
  onRetry,
  onAudioOnly,
  onChangeFolder,
  onWaitForVideo,
  retryKey,
  copyText,
  report
}: FixBarProps): JSX.Element {
  const t = useT()
  const saveSettings = useStore((s) => s.saveSettings)
  const openSettings = useStore((s) => s.openSettings)
  const platform = useStore((s) => s.appInfo?.platform)
  // A cookies file takes precedence over a browser, so picking one would change nothing.
  const usesCookiesFile = useStore((s) => Boolean(s.settings?.cookiesFile))
  const fix = fixFor(errorCode, cookieHint)
  const waitingUntil = useSyncExternalStore(subscribeRetries, () => retryAt(retryKey))

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyText)
      toast(t('common.copied'), 'success')
    } catch {
      /* clipboard unavailable */
    }
  }

  const changeFolder = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) onChangeFolder(dir)
  }

  const fixButton = (): JSX.Element | null => {
    switch (fix) {
      case 'cookiesFile':
        return (
          <button type="button" className="btn-quiet" data-fix="cookiesFile" onClick={() => openSettings('access#cookies')}>
            <ChannelSecure size={14} /> {t(FIX_LABEL.cookiesFile)}
          </button>
        )
      case 'proxy':
        return (
          <button type="button" className="btn-quiet" data-fix="proxy" onClick={() => openSettings('network')}>
            <Globe size={14} /> {t(FIX_LABEL.proxy)}
          </button>
        )
      case 'cookies':
        return (
          <Menu
            label={t(FIX_LABEL.cookies)}
            align="start"
            items={[
              // What the built-in browser signs in to, downloads use too: no browser to pick.
              { label: t('fix.signInHere'), onSelect: () => window.api.openBrowser(url || undefined) },
              'separator' as const,
              ...(usesCookiesFile
                ? []
                : [
                    ...cookieBrowsersFor(platform).map((b) => ({
                      label: t('fix.cookiesFrom', { browser: browserLabel(b) }),
                      onSelect: () => {
                        void saveSettings({ cookiesFromBrowser: b }).then(onRetry)
                      }
                    })),
                    'separator' as const
                  ]),
              { label: t('fix.cookiesSettings'), onSelect: () => openSettings('access#cookies') }
            ]}
            trigger={(props) => (
              <button type="button" className="btn-quiet" data-fix="cookies" {...props}>
                <ChannelSecure size={14} /> {t(FIX_LABEL.cookies)}
              </button>
            )}
          />
        )
      case 'browser':
        return (
          <button type="button" className="btn-quiet" data-fix="browser" onClick={() => window.api.openBrowser(url || undefined)}>
            <Globe size={14} /> {t(FIX_LABEL.browser)}
          </button>
        )
      case 'audioOnly':
        return (
          <button type="button" className="btn-quiet" data-fix="audioOnly" onClick={onAudioOnly}>
            <Multimedia size={14} /> {t(FIX_LABEL.audioOnly)}
          </button>
        )
      case 'changeFolder':
        return (
          <button type="button" className="btn-quiet" data-fix="changeFolder" onClick={() => void changeFolder()}>
            <Folder size={14} /> {t(FIX_LABEL.changeFolder)}
          </button>
        )
      case 'waitForVideo':
        return (
          <button type="button" className="btn-quiet" data-fix="waitForVideo" onClick={onWaitForVideo}>
            <Clock size={14} /> {t(FIX_LABEL.waitForVideo)}
          </button>
        )
      case 'retryLater':
        return (
          <button
            type="button"
            className="btn-quiet"
            data-fix="retryLater"
            disabled={waitingUntil !== undefined}
            onClick={() => scheduleRetry(retryKey, onRetry)}
          >
            <Clock size={14} />{' '}
            {waitingUntil !== undefined
              ? t('fix.retryingAt', {
                  time: new Date(waitingUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                })
              : t(FIX_LABEL.retryLater)}
          </button>
        )
      default:
        return null
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {fixButton()}
        {report && (
          <button type="button" className="btn-quiet" aria-expanded={report.open} onClick={report.onToggle}>
            <Send size={14} /> {t('fix.report')}
          </button>
        )}
        <button type="button" className="btn-quiet" onClick={() => void copy()}>
          <Copy size={14} /> {t('fix.copyError')}
        </button>
      </div>
      {report && !report.open && <p className="mt-1.5 text-meta text-ink-2">{t('fix.reportConsent')}</p>}
    </div>
  )
}
