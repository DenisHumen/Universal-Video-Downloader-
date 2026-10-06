import { clampTime } from './time'

export type TrimHandle = 'start' | 'end'

export interface TrimSpan {
  start: number
  /** Where the end handle sits: the chosen end, or the whole length. */
  end: number
  total: number
}

/**
 * Where a key press moves one of the trim editor's handles, in seconds, or
 * null for a key the handles leave alone.
 *
 * The keys of the WAI-ARIA slider pattern. Arrows step by a second (five with
 * Shift), Up and Down mirror Right and Left, Page Up and Page Down jump by a
 * twentieth of the video but never less than ten seconds, and Home and End go
 * to either end of the timeline. The handles used to answer the left and right
 * arrows only, which put the end of a two-hour stream 7,200 presses away.
 *
 * A handle never passes the other one, the same rule dragging follows, so no
 * key can produce the "end before start" range the editor would then refuse.
 */
export function trimKeyTarget(
  key: string,
  shift: boolean,
  handle: TrimHandle,
  { start, end, total }: TrimSpan
): number | null {
  const current = handle === 'start' ? start : end
  const step = shift ? 5 : 1
  const page = Math.max(10, Math.round(total * 0.05))
  let next: number
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      next = current - step
      break
    case 'ArrowRight':
    case 'ArrowUp':
      next = current + step
      break
    case 'PageDown':
      next = current - page
      break
    case 'PageUp':
      next = current + page
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = total
      break
    default:
      return null
  }
  next = handle === 'start' ? Math.min(next, Math.max(0, end - 0.1)) : Math.max(next, start + 0.1)
  return clampTime(next, total)
}
