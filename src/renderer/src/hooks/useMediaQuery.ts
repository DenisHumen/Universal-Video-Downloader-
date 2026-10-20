import { useEffect, useState } from 'react'

/**
 * Whether a media query matches, kept current as the window is resized.
 *
 * `matchMedia`'s change event is dispatched by the style engine, not on an
 * animation frame, so this stays right in a window whose frame clock is
 * throttled - where a resize observer's callback may not run at all.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = (): void => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}
