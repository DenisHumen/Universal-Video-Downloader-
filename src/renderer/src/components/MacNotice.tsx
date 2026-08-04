import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, ShieldAlert, X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

const COMMAND = 'sudo xattr -rd com.apple.quarantine /Applications/Universal\\ Video\\ Downloader.app'
const STORAGE_KEY = 'uvd:mac-notice-dismissed'

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
      /* ignore */
    }
  }

  const dismiss = (): void => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="shrink-0"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-warn/20 bg-warn/[0.07] px-4 py-2.5">
          <ShieldAlert size={17} className="shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-cream">{t('mac.title')}</p>
            <code className="mono mt-1 block truncate text-[11px] text-fg/45" title={COMMAND}>
              {COMMAND}
            </code>
          </div>
          <button className="btn-ghost shrink-0 px-3 py-2" onClick={copy}>
            {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button className="btn-icon shrink-0" onClick={dismiss} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
