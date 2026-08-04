import { useEffect } from 'react'
import { useStore, type ViewId } from '../store'

const VIEW_BY_DIGIT: Record<string, ViewId> = {
  '1': 'home',
  '2': 'search',
  '3': 'downloads',
  '4': 'settings'
}

/**
 * Global keyboard shortcuts. ⌘/Ctrl+1…4 switch views, ⌘/Ctrl+, opens settings,
 * ⌘/Ctrl+/ shows the shortcut list, Esc closes whatever is open.
 */
export function useShortcuts(): void {
  const setView = useStore((s) => s.setView)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setShortcutsOpen(false)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const view = VIEW_BY_DIGIT[e.key]
      if (view) {
        e.preventDefault()
        setView(view)
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        setView('settings')
      } else if (e.key === '/' || e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(!useStore.getState().shortcutsOpen)
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setView('search')
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setView('home')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, setShortcutsOpen])
}
