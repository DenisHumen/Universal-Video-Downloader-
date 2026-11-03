import { useEffect, useRef, type ReactNode } from 'react'

export interface StackPage {
  /** Stable key: the page's route segment. */
  key: string
  node: ReactNode
}

interface Props {
  /** Root first; the last page is the one shown. */
  pages: StackPage[]
  /** Go back one page (Esc, Alt+←, or the back button the page draws). */
  onBack: () => void
  className?: string
}

/**
 * AdwNavigationView, CSS only (D3, A1.1 §2): the top page is shown; a page
 * pushed slides in 100% from the end on libadwaita's critically damped
 * spring (--ease-spring, --t-spring), a pop slides the revealed page back
 * from the start. Under reduced motion the global override takes the
 * animation to ~0 ms, which is the cross-fade-at-0 the spec asks for.
 * No requestAnimationFrame and no fill-mode: a page at rest has no
 * transform whether the animation ran or not, and the stack host itself
 * never transforms (only the page inside it does).
 *
 * Esc and Alt+← go back while there is somewhere to go back to; Esc is left
 * alone when an open dialog or popover owns it (those stop it themselves).
 */
/* Whole class names, so Tailwind keeps them. */
const SLIDE = { push: 'ui-page-push', pop: 'ui-page-pop' }

export default function NavigationStack({ pages, onBack, className }: Props): JSX.Element {
  const depth = pages.length
  const previous = useRef(depth)
  const direction = depth >= previous.current ? 'push' : 'pop'
  useEffect(() => {
    previous.current = depth
  }, [depth])

  useEffect(() => {
    if (depth < 2) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const back = (e.key === 'Escape' && !e.ctrlKey && !e.metaKey) || (e.key === 'ArrowLeft' && e.altKey)
      if (!back) return
      const t = e.target as HTMLElement | null
      // Esc in a text field clears or leaves the field first, as GTK's does.
      if (e.key === 'Escape' && t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      e.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [depth, onBack])

  const top = pages[depth - 1]
  return (
    <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}>
      <div
        key={top?.key}
        className={`flex min-h-0 flex-1 flex-col ${depth > 1 || direction === 'pop' ? SLIDE[direction] : ''}`}
        data-page={top?.key}
      >
        {top?.node}
      </div>
    </div>
  )
}
