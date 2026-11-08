import { useEffect, useRef, useState } from 'react'
import type { LibraryHit } from '@shared/library'

const NO_HITS: ReadonlyMap<string, LibraryHit> = new Map()

/**
 * Which of these links are already kept, by the link as given, asked again when
 * the Library changes. The answer belongs to one list of links: a card showing
 * another video must not draw the last one's "you already have this", even for
 * the moment before its own answer lands.
 */
export function useLibraryHits(links: string[]): ReadonlyMap<string, LibraryHit> {
  const key = links.join('\n')
  const [answer, setAnswer] = useState<{ key: string; hits: ReadonlyMap<string, LibraryHit> } | null>(null)
  const latest = useRef(links)
  latest.current = links

  useEffect(() => {
    let live = true
    let asked = 0
    const ask = (): void => {
      const turn = ++asked
      void window.api
        .libraryLookup(latest.current)
        .then((found) => {
          if (live && turn === asked) setAnswer({ key, hits: new Map(found.map((h) => [h.link, h])) })
        })
        // Only a nicety on top of the card: without an answer it is simply not shown.
        .catch(() => undefined)
    }
    ask()
    const off = window.api.onLibraryChanged(ask)
    return () => {
      live = false
      off()
    }
  }, [key])

  return answer?.key === key ? answer.hits : NO_HITS
}
