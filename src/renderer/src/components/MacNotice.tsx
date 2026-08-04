import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

const COMMAND = 'sudo xattr -rd com.apple.quarantine /Applications/Universal\\ Video\\ Downloader.app'
const STORAGE_KEY = 'uvd:mac-notice-dismissed'

/** Gatekeeper's "damaged app" message, and the one command that clears it. */
export default function MacNotice(): JSX.Element | null {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  const [copied, setCopied] = useState(false)

  if (appInfo?.platform !== 'darwin' || dismissed) return null

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  const dismiss = (): void => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-raise px-4 py-2.5">
      <span className="label shrink-0 text-warn">macos</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{t('mac.title')}</p>
        <code className="mono selectable block truncate text-[12px] text-ink-2" title={COMMAND}>
          {COMMAND}
        </code>
      </div>
      <button className="btn-quiet shrink-0 px-3 py-2" onClick={copy}>
        {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
        {copied ? t('common.copied') : t('common.copy')}
      </button>
      <button className="btn-icon" onClick={dismiss} aria-label={t('common.close')}>
        <X size={15} />
      </button>
    </div>
  )
}
