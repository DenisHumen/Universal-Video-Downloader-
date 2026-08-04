import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Accessible name for the strip. */
  label?: string
  className?: string
}

/** How far one arrow press travels. Roughly two tabs — enough to feel like
 *  progress, short enough that you never lose your place. */
const STEP = 220

/**
 * A horizontal strip of tabs that scrolls without a scrollbar.
 *
 * The strips used to be plain `overflow-x-auto`, which paints a 10px scrollbar
 * inside a 48px bar of chrome — a band of grey noise across the top of the
 * window, and in Settings a second one under the section index. Worse, a
 * scrollbar is the one affordance you cannot use without first noticing it.
 *
 * Here the bar is hidden and the overflow is expressed the way a person would
 * expect: an arrow on whichever side still has content, which they can click.
 * The arrows only exist while there is somewhere to go, so a strip that fits
 * looks exactly like plain tabs.
 */
export default function TabStrip({ children, label, className }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 1px of slack: sub-pixel layout means scrollLeft rarely hits the exact end.
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // Tabs are translated, so their width changes with the language.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure, children])

  /*
    An instant scroll, and no `scroll-smooth` on the container.
    Smooth scrolling is driven by the frame clock, and measured with that clock
    stalled the arrows moved nothing at all. An arrow that sometimes does
    nothing is worse than one that jumps.
  */
  const scrollBy = (delta: number): void => {
    ref.current?.scrollBy({ left: delta })
    /*
      Re-measure here rather than waiting for the `scroll` event: Chrome
      dispatches that event before the next paint, so on a stalled frame clock
      it never arrives and the arrows keep pointing somewhere you have already
      been. `scrollLeft` is updated synchronously, so reading it now is exact.
    */
    measure()
  }

  return (
    <div className={`relative flex min-w-0 items-stretch ${className ?? ''}`}>
      {canLeft && (
        <button
          type="button"
          className="btn-icon-bare h-auto w-7 shrink-0 rounded-none"
          onClick={() => scrollBy(-STEP)}
          aria-label="scroll left"
          tabIndex={-1}
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        className="no-scrollbar flex min-w-0 items-stretch gap-0.5 overflow-x-auto"
      >
        {children}
      </div>

      {canRight && (
        <button
          type="button"
          className="btn-icon-bare h-auto w-7 shrink-0 rounded-none"
          onClick={() => scrollBy(STEP)}
          aria-label="scroll right"
          tabIndex={-1}
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}
