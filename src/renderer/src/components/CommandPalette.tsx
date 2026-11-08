import { showFile } from '../lib/showFile'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'
import { matchesQuery } from '../lib/settingsSearch'
import { linkIn } from '../lib/shortcuts'
import { recentFinished } from '../lib/downloads'
import Modal from './Modal'
import { NAV_ALL } from '../shell/nav'
import { PANELS } from '../views/settings/router'
import { searchSettings } from '../views/settings/searchIndex'
import { cx } from '../ui'
import { GoNext, Search } from '../ui/icons'

/*
  Ctrl/⌘+K (plan 4.5): one field that finds anything - a section, an action,
  a recent download, or a setting (the same index Settings' search uses,
  each hit deep-linking). An ARIA combobox over a listbox: typing filters,
  ↑/↓ move, Enter runs, Esc closes; focus never leaves the field.
*/

type Group = 'navigate' | 'actions' | 'recent' | 'settings'

interface Command {
  id: string
  group: Group
  label: string
  hint?: string
  run: () => void | Promise<void>
}

const GROUP_LABEL: Record<Group, TranslationKey> = {
  navigate: 'palette.navigate',
  actions: 'palette.actions',
  recent: 'palette.recent',
  settings: 'palette.settings'
}

/** At most this many per group while nothing is typed, so the list stays a menu. */
const IDLE_PER_GROUP = 6

export default function CommandPalette(): JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  if (!open) return null
  return <Palette />
}

function Palette(): JSX.Element {
  const t = useT()
  const close = (): void => useStore.getState().setPaletteOpen(false)
  const downloads = useStore((s) => s.downloads)
  const settings = useStore((s) => s.settings)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const titleId = useId()

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState()
    const list: Command[] = [
      ...NAV_ALL.map((n) => ({ id: `nav-${n.id}`, group: 'navigate' as const, label: t(n.label), run: () => s.setView(n.id) })),
      ...PANELS.map((p) => ({
        id: `panel-${p.id}`,
        group: 'navigate' as const,
        label: `${t('nav.settings')} › ${t(p.title)}`,
        run: () => s.openSettings(p.id)
      })),
      {
        id: 'paste',
        group: 'actions',
        label: t('palette.paste'),
        run: async () => {
          const link = linkIn(await window.api.readClipboard())
          if (link) s.requestDetect(link)
          else s.setView('home')
        }
      },
      { id: 'pauseAll', group: 'actions', label: t('queue.pauseAll'), run: () => void window.api.pauseAll() },
      { id: 'resumeAll', group: 'actions', label: t('queue.resumeAll'), run: () => void window.api.resumeAll() },
      {
        id: 'folder',
        group: 'actions',
        label: t('palette.openFolder'),
        run: () => void (settings?.downloadDir && window.api.openPath(settings.downloadDir))
      },
      { id: 'watch', group: 'actions', label: t('palette.addWatch'), run: () => s.requestWatch({ url: '' }) },
      { id: 'browser', group: 'actions', label: t('browser.open'), run: () => void window.api.openBrowser() },
      { id: 'shortcuts', group: 'actions', label: t('shortcuts.title'), run: () => s.setShortcutsOpen(true) },
      ...recentFinished(downloads, 5).map((d) => ({
        id: `recent-${d.id}`,
        group: 'recent' as const,
        label: d.title,
        hint: t('palette.showInFolder'),
        run: () => void (d.filepath && showFile(d.filepath))
      }))
    ]
    return list
  }, [t, downloads, settings?.downloadDir])

  const shown = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const counts: Partial<Record<Group, number>> = {}
      return commands.filter((c) => (counts[c.group] = (counts[c.group] ?? 0) + 1) <= IDLE_PER_GROUP)
    }
    const hits = commands.filter((c) => matchesQuery(q, c.label, c.hint))
    const settingHits: Command[] = searchSettings(q, t)
      .slice(0, 8)
      .map((h) => ({
        id: `set-${h.entry.route}`,
        group: 'settings',
        label: t(h.entry.title),
        hint: h.where,
        run: () => useStore.getState().openSettings(h.entry.route)
      }))
    return [...hits, ...settingHits]
  }, [query, commands, t])

  const at = Math.min(active, Math.max(0, shown.length - 1))
  const run = async (c: Command | undefined): Promise<void> => {
    if (!c) return
    close()
    await c.run()
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((at + step + shown.length) % Math.max(1, shown.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void run(shown[at])
    }
  }

  let lastGroup: Group | null = null
  return (
    <Modal onClose={close} labelledBy={titleId} initialFocus={input} layer="overlay" className="surface-dialog mt-[10vh] flex max-h-[70vh] w-full max-w-[560px] flex-col self-start overflow-hidden">
      <h2 id={titleId} className="sr-only">
        {t('palette.title')}
      </h2>
      <label className="flex items-center gap-3 border-b border-edge-soft px-4">
        <Search size={16} className="shrink-0 text-ink-2" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[at] ? `${listId}-${shown[at].id}` : undefined}
          aria-label={t('palette.title')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          placeholder={t('palette.placeholder')}
          className="no-drag h-12 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          spellCheck={false}
        />
      </label>
      <ul id={listId} role="listbox" aria-label={t('palette.title')} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-body text-ink-2">{t('palette.empty')}</li>}
        {shown.map((c, i) => {
          const header = c.group !== lastGroup
          lastGroup = c.group
          return (
            <li key={c.id} role="presentation">
              {header && (
                <div role="presentation" className="px-3 pb-1 pt-2.5 text-caption-heading text-ink-2">
                  {t(GROUP_LABEL[c.group])}
                </div>
              )}
              <div
                id={`${listId}-${c.id}`}
                role="option"
                aria-selected={i === at}
                className={cx('ui-menu-item cursor-pointer', i === at && 'bg-fill/10')}
                onMouseMove={() => setActive(i)}
                onClick={() => void run(c)}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 truncate text-meta text-ink-2">{c.hint}</span>}
                {i === at && <GoNext size={14} className="shrink-0 text-ink-2" />}
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
