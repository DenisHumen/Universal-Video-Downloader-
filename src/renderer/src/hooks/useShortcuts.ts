import { useEffect } from 'react'
import { useStore } from '../store'
import { chordAction } from '../lib/shortcuts'

/**
 * Global keyboard shortcuts. ⌘/Ctrl+1…5 switch views (N, F and comma are
 * aliases for three of them), ⌘/Ctrl+/ shows the shortcut list. The table both
 * this and the list read is in lib/shortcuts.
 *
 * Esc is not here. The list is a Modal, and Modal answers Esc for whichever
 * dialog is on top: this hook used to close the list on every Esc, even when a
 * confirmation had opened over it and should have been the one to go.
 */
export function useShortcuts(): void {
  const setView = useStore((s) => s.setView)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return

      const action = chordAction(e.key, e.code)
      if (!action) return
      e.preventDefault()
      if (action === 'help') setShortcutsOpen(!useStore.getState().shortcutsOpen)
      else setView(action)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [setView, setShortcutsOpen])
}
