import { Fragment, useId } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../i18n'
import { SHORTCUT_ROWS } from '../lib/shortcuts'
import Dialog from '../ui/Dialog'

export default function ShortcutsOverlay(): JSX.Element {
  const t = useT()
  const titleId = useId()
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcutsOpen)
  const isMac = useStore((s) => s.appInfo?.platform === 'darwin')
  const mod = isMac ? '⌘' : 'Ctrl'

  return (
    <AnimatePresence>
      {open && (
        <Dialog
          key="shortcuts"
          variant="sheet"
          title={t('shortcuts.title')}
          closeLabel={t('common.close')}
          onClose={() => setOpen(false)}
          layer="overlay"
        >
          <div className="ui-boxed-list">
            {SHORTCUT_ROWS.map((row) => (
              <div key={row.label} className="ui-row justify-between gap-4">
                <span className="text-body text-ink">{t(row.label)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {row.keys.map((chord, i) => (
                    <Fragment key={chord.join('+')}>
                      {i > 0 && <span className="px-1 text-meta text-ink-3">{t('shortcuts.or')}</span>}
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
        </Dialog>
      )}
    </AnimatePresence>
  )
}
