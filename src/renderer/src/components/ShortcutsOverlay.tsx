import { Fragment } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { dialog, overlay } from '../lib/motion'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { SHORTCUT_ROWS } from '../lib/shortcuts'

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
            className="panel w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <h2 className="label">{t('shortcuts.title')}</h2>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label={t('common.close')}>
                <X size={15} />
              </button>
            </div>
            <div className="px-4">
              {SHORTCUT_ROWS.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 border-b border-edge py-2.5 last:border-b-0"
                >
                  <span className="text-[13px] text-ink-2">{t(row.label)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.keys.map((chord, i) => (
                      <Fragment key={chord.join('+')}>
                        {i > 0 && <span className="px-1 text-[12px] text-ink-3">{t('shortcuts.or')}</span>}
                        {chord.map((key) => (
                          <kbd key={key} className="kbd">
                            {key === 'mod' ? mod : key}
                          </kbd>
                        ))}
                      </Fragment>
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
