import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

/**
 * No `sudo`.
 *
 * `xattr` writes an extended attribute on a file the user already owns —
 * copying an app into /Applications makes them its owner — so elevation buys
 * nothing and costs a password prompt on a command people are being asked to
 * paste into a terminal on trust. The path is quoted rather than
 * backslash-escaped for the same reason: it is easier to read, and it survives
 * being copied through anything that mangles backslashes.
 */
const COMMAND = 'xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app"'
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
        {/* Why, before what. "Damaged" is a lie the OS tells about every
            unsigned build, and someone who doesn't know that reasonably
            assumes the download broke and fetches it again. */}
        <p className="hint">{t('mac.why')}</p>
        <code
          className="mono selectable mt-1 block truncate text-[12px] text-ink-2"
          title={COMMAND}
        >
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
