import { useEffect } from 'react'
import { useStore } from '../store'
import { chordAction } from '../lib/shortcuts'

/**
 * Global keyboard shortcuts. ⌘/Ctrl+1…5 switch views (N, F and comma are
 * aliases for three of them), ⌘/Ctrl+/ shows the shortcut list, Esc closes it.
 * The table both this and the list read is in lib/shortcuts.
 */
export function useShortcuts(): void {
  const setView = useStore((s) => s.setView)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        /*
          An Esc that closes the list is spent on it. This listener runs in the
          capture phase, ahead of every other one on the window — and Home's
          Esc clears the link and the result, so the keypress meant to close
          the list also threw away the video just found. Only this Esc stops,
          though: ConfirmDialog and MediaJobModal close on Esc too.
        */
        if (useStore.getState().shortcutsOpen) {
          e.preventDefault()
          e.stopImmediatePropagation()
          setShortcutsOpen(false)
        }
        return
      }
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
