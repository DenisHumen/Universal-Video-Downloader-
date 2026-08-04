import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'

const ROWS: { keys: string[]; label: TranslationKey }[] = [
  { keys: ['mod', '1'], label: 'shortcuts.newDownload' },
  { keys: ['mod', '2'], label: 'shortcuts.search' },
  { keys: ['mod', '3'], label: 'shortcuts.queue' },
  { keys: ['mod', '4'], label: 'shortcuts.settings' },
  { keys: ['mod', 'V'], label: 'shortcuts.paste' },
  { keys: ['mod', '/'], label: 'shortcuts.help' },
  { keys: ['Esc'], label: 'shortcuts.escape' }
]

export default function ShortcutsOverlay(): JSX.Element {
  const t = useT()
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcutsOpen)
  const isMac = useStore((s) => s.appInfo?.platform === 'darwin')
  const mod = isMac ? '⌘' : 'Ctrl'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="card w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-fg/[0.06] px-5 py-4">
              <h2 className="text-sm font-semibold text-cream">{t('shortcuts.title')}</h2>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label={t('common.close')}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-1 p-3">
              {ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-xl px-2.5 py-2 transition-colors hover:bg-fg/[0.03]"
                >
                  <span className="text-[13px] text-cream-dim">{t(row.label)}</span>
                  <span className="flex items-center gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="mono rounded-lg border border-fg/[0.09] bg-fg/[0.05] px-2 py-1 text-[11px] text-fg/70"
                      >
                        {key === 'mod' ? mod : key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
