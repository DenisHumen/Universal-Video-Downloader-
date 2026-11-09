/**
 * Where links sent from outside arrive, one at a time.
 *
 * A page can fire `uvd://` in a loop, and each one is a launch handing a link to
 * this process. The window takes focus for the first and then for at most one
 * more per cool-down, however many come, and of those that came while cooling
 * down only the last is kept: a bounded slot, not a queue somebody could fill.
 */
export const LINK_COOL_DOWN_MS = 1500

export interface LinkInbox {
  take: (link: string) => void
}

export function createLinkInbox(hooks: { hand: (link: string) => void; raise: () => void }, coolDownMs = LINK_COOL_DOWN_MS): LinkInbox {
  let cooling = false
  let last: string | null = null
  let waiting: string | null = null

  const pass = (link: string): void => {
    cooling = true
    last = link
    hooks.hand(link)
    hooks.raise()
    setTimeout(() => {
      cooling = false
      const next = waiting
      waiting = null
      if (next) pass(next)
    }, coolDownMs)
  }

  return {
    take(link) {
      if (!cooling) pass(link)
      // The same link again, from a double click, is not news.
      else if (link !== last) waiting = link
    }
  }
}
