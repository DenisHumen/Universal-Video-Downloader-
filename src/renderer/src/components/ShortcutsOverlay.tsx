import { AnimatePresence, motion } from 'framer-motion'
import { dialog, overlay } from '../lib/motion'
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
          {...overlay}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
          style={{ zIndex: 'var(--z-overlay)' }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            {...dialog}
            className="block w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <h2 className="label">{t('shortcuts.title')}</h2>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label={t('common.close')}>
                <X size={15} />
              </button>
            </div>
            <div className="px-4">
              {ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 border-b border-edge py-2.5 last:border-b-0"
                >
                  <span className="text-[12px] text-ink-2">{t(row.label)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.keys.map((key) => (
                      <kbd key={key} className="kbd">
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
