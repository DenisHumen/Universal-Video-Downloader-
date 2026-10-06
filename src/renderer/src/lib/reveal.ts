/** A horizontal scroller's visible window, in its content's coordinates. */
export interface ScrollView {
  scrollLeft: number
  width: number
}

/** An item inside that scroller, in the same coordinates. */
export interface ScrollItem {
  left: number
  width: number
}

/**
 * The scroll position that shows the whole item while moving as little as
 * possible: unchanged when it is already in view, otherwise just far enough to
 * bring its near edge in. An item wider than the view is aligned to its start,
 * so its label's beginning is what shows.
 *
 * Computed rather than left to `scrollIntoView`, which also scrolls every
 * scrollable ancestor - including a body with `overflow: hidden`, which can
 * still be scrolled by script and then never scrolled back.
 */
export function revealScroll(view: ScrollView, item: ScrollItem): number {
  if (item.left < view.scrollLeft) return item.left
  const overflow = item.left + item.width - (view.scrollLeft + view.width)
  if (overflow > 0) return Math.min(item.left, view.scrollLeft + overflow)
  return view.scrollLeft
}
