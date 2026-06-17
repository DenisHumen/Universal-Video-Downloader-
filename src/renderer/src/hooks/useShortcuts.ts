import { useEffect } from 'react'
import { useStore } from '../store'

/** Global keyboard shortcuts: ⌘/Ctrl+1/2/3 to switch views, ⌘/Ctrl+, for settings. */
export function useShortcuts(): void {
  const setView = useStore((s) => s.setView)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === '1') {
        e.preventDefault()
        setView('home')
      } else if (e.key === '2') {
        e.preventDefault()
        setView('downloads')
      } else if (e.key === '3') {
        e.preventDefault()
        setView('settings')
      } else if (e.key === ',') {
        e.preventDefault()
        setView('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])
}
