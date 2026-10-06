import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useT } from '../i18n'
import { revealScroll } from '../lib/reveal'

interface Props {
  children: ReactNode
  /** Accessible name for the navigation landmark. */
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
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  /** The arrows as last measured, so a measurement can tell whether it moved them. */
  const shown = useRef({ left: false, right: false })

  /** Update the arrows; true when one appeared or went. */
  const measure = useCallback((): boolean => {
    const el = ref.current
    if (!el) return false
    // 1px of slack: sub-pixel layout means scrollLeft rarely hits the exact end.
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    const changed = left !== shown.current.left || right !== shown.current.right
    shown.current = { left, right }
    setCanLeft(left)
    setCanRight(right)
    return changed
  }, [])

  /** Bring a tab fully into view; true when that moved an arrow. */
  const scrollTo = useCallback(
    (item: Element): boolean => {
      const el = ref.current
      if (!el) return false
      const box = el.getBoundingClientRect()
      const rect = item.getBoundingClientRect()
      const next = revealScroll(
        { scrollLeft: el.scrollLeft, width: el.clientWidth },
        { left: rect.left - box.left + el.scrollLeft, width: rect.width }
      )
      // Instant, and measured at once, for the reasons given at scrollBy below.
      if (next !== el.scrollLeft) el.scrollLeft = next
      return measure()
    },
    [measure]
  )
  /** The tab just revealed, until the arrows have settled around it; see the layout effect below. */
  const settling = useRef<Element | null>(null)
  /*
    Scroll a tab fully into view: the one that was just selected, or the one
    Tab just moved to. Keyboard focus used to land on a tab half hidden behind
    the arrow, and the arrows themselves are out of the tab order on purpose,
    so the only way to see the rest of it was the mouse.
  */
  const reveal = useCallback(
    (target: EventTarget | null) => {
      const el = ref.current
      if (!el || !(target instanceof Element)) return
      let item: Element | null = target
      while (item && item.parentElement !== el) item = item.parentElement
      if (!item) return
      // Only an arrow that moved changes the strip's width and needs a second pass.
      settling.current = scrollTo(item) ? item : null
    },
    [scrollTo]
  )
  /** The page tab last brought into view, so a re-render does not undo the user's own scrolling. */
  const revealed = useRef<Element | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    const current = el.querySelector('[aria-current="page"]')
    if (current !== revealed.current) {
      revealed.current = current
      reveal(current)
    }
    el.addEventListener('scroll', measure, { passive: true })
    // Tabs are translated, so their width changes with the language.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure, reveal, children])

  /*
    An arrow coming or going takes its 28px from the strip, which can push the
    far end of a just-revealed tab back behind the other arrow. Settle that as
    soon as React has laid the arrows out, before paint, rather than waiting on
    the ResizeObserver: its callbacks ride the frame clock, and with the clock
    stalled the strip stayed clipped and the arrows stayed wrong.

    Once only, for the tab just revealed. Re-revealing whatever had focus on
    every arrow change would snap the strip back each time the user scrolled
    it themselves.
  */
  useLayoutEffect(() => {
    const item = settling.current
    settling.current = null
    if (item && ref.current?.contains(item)) scrollTo(item)
    else measure()
  }, [canLeft, canRight, measure, scrollTo])

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

  /*
    A navigation landmark, not a tab list. The buttons switch pages and mark
    the current one with aria-current; there are no tab panels and no arrow-key
    roving, so role="tablist" announced a widget that did not behave as one.
  */
  return (
    <nav aria-label={label} className={`relative flex min-w-0 items-stretch ${className ?? ''}`}>
      {canLeft && (
        <button
          type="button"
          className="btn-icon-bare h-auto w-7 shrink-0 rounded-none"
          onClick={() => scrollBy(-STEP)}
          aria-label={t('a11y.scrollLeft')}
          tabIndex={-1}
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={ref}
        className="no-scrollbar flex min-w-0 items-stretch gap-0.5 overflow-x-auto"
        onFocus={(e) => reveal(e.target)}
      >
        {children}
      </div>

      {canRight && (
        <button
          type="button"
          className="btn-icon-bare h-auto w-7 shrink-0 rounded-none"
          onClick={() => scrollBy(STEP)}
          aria-label={t('a11y.scrollRight')}
          tabIndex={-1}
        >
          <ChevronRight size={16} />
        </button>
      )}
    </nav>
  )
}
