import { useEffect, useRef, useState } from 'react'
import type { AppErrorCode, DetectResult, MediaInfo, SearchResult } from '@shared/types'
import { allowedSearchServices, SEARCH_ALL_SERVICES } from '@shared/types'
import { needsCookiesOften } from '@shared/urls'
import { detectCache, inflightDetects, useStore } from '../../store'
import { describeError } from '../../lib/errors'
import { isProbablyUrl } from '../../lib/format'

/*
  The Download view's state machines, out of the view (5.4): a detect (link →
  card or error) and the inline search for text that is not a link.
*/

export type DetectStatus = 'idle' | 'detecting' | 'error'

export interface DetectFailure {
  error: string
  errorCode?: AppErrorCode
  cookieHint: boolean
  /** The failed link main kept for an error report — the field may be edited since. */
  reported: { id: string; url: string } | null
}

const NO_FAILURE: DetectFailure = { error: '', cookieHint: false, reported: null }

export interface UseDetect {
  status: DetectStatus
  info: MediaInfo | null
  /** The link the result or error on screen came from; see `detectIsDone`. */
  detectedUrl: string
  failure: DetectFailure
  /** Detect a link; resolves once its card or error is on screen (or it was superseded). */
  detect: (target: string, onShown?: (info: MediaInfo) => void) => Promise<void>
  /** Stop the detect in flight and go back to idle. */
  cancel: () => void
  /** Clear the card, the error and any detect in flight. */
  clear: () => void
  /** Drop the result card (a series or playlist that queued itself). */
  dropInfo: () => void
}

export function useDetect(fallbackError: string): UseDetect {
  const beginDetect = useStore((s) => s.beginDetect)
  const endDetect = useStore((s) => s.endDetect)
  const [status, setStatus] = useState<DetectStatus>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [detectedUrl, setDetectedUrl] = useState('')
  const [failure, setFailure] = useState<DetectFailure>(NO_FAILURE)
  const requestRef = useRef<string | null>(null)

  /** Stop listening for the detect in flight, and stop the engine working on it. */
  const dropRequest = (): void => {
    if (requestRef.current) void window.api.cancelDetect(requestRef.current)
    requestRef.current = null
    endDetect()
  }

  /** Put a detect's outcome on screen, whether it just ran or came from the cache. */
  const show = (target: string, res: DetectResult, onShown?: (info: MediaInfo) => void): void => {
    setDetectedUrl(target)
    if (res.ok && res.info) {
      setInfo(res.info)
      onShown?.(res.info)
      setStatus('idle')
    } else {
      setFailure({
        error: res.error || fallbackError,
        errorCode: res.errorCode,
        cookieHint: Boolean(res.cookieHint) || needsCookiesOften(target),
        reported: res.reportId ? { id: res.reportId, url: target } : null
      })
      setStatus('error')
    }
  }

  const detect = async (target: string, onShown?: (info: MediaInfo) => void): Promise<void> => {
    // A new link supersedes one still detecting; the engine can stop on that.
    dropRequest()
    setFailure(NO_FAILURE)
    // The same link detected in the last few minutes: its card, at once.
    const cached = detectCache.get(target)
    if (cached) {
      show(target, cached, onShown)
      return
    }
    /*
      The clipboard strip may have started this one already; waiting on that
      run, under its request id, is both faster and one engine fewer. Its
      stage and preview events then reach this card too.
    */
    const adopted = inflightDetects.take(target)
    const requestId = adopted?.requestId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    requestRef.current = requestId
    beginDetect(target, requestId)
    setStatus('detecting')
    setInfo(null)
    // Main reports an engine that won't install as a coded result, but any
    // other rejected invoke would otherwise leave the card in its skeleton.
    let res: DetectResult = await (adopted?.promise ?? window.api.detect(target, requestId)).catch(
      (err: unknown) => ({ ok: false, error: describeError(err) })
    )
    if (requestRef.current !== requestId) return
    /*
      A prefetch is the engine probe alone, with no page scrape or browser
      behind it. When that was not enough, run the whole detect now that
      someone is actually waiting for it.
    */
    if (adopted && !res.ok && res.errorCode !== 'canceled') {
      res = await window.api.detect(target, requestId).catch(
        (err: unknown) => ({ ok: false, error: describeError(err) })
      )
      if (requestRef.current !== requestId) return
    }
    requestRef.current = null
    endDetect()
    detectCache.set(target, res)
    show(target, res, onShown)
  }

  const cancel = (): void => {
    dropRequest()
    setStatus('idle')
  }

  /*
    Clearing the screen used to leave the detect running underneath it: Esc a
    moment after pasting emptied the field, then the result card arrived under
    the empty field a second later, and yt-dlp worked on to the end regardless.
  */
  const clear = (): void => {
    dropRequest()
    setInfo(null)
    setFailure(NO_FAILURE)
    setStatus('idle')
  }

  // Leaving Download — ⌘/Ctrl+2…5 mid-detect — leaves no engine request behind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => dropRequest(), [])

  return { status, info, detectedUrl, failure, detect, cancel, clear, dropInfo: () => setInfo(null) }
}

/** How long typing has to pause before a title is searched (plan 5.4: ≥ 400 ms). */
export const SEARCH_DEBOUNCE_MS = 400
/** How many results the Download view shows inline (plan 5.4: 3–5). */
export const INLINE_RESULTS = 5

export type InlineSearchStatus = 'idle' | 'searching' | 'done' | 'error'

export interface UseInlineSearch {
  status: InlineSearchStatus
  results: SearchResult[]
  /** The query the results on screen answer. */
  query: string
  /** Search now (Enter), without waiting for the debounce. */
  runNow: () => void
}

/**
 * Plain text in the Download entry searches by title, inline: on Enter, or
 * once typing has paused for 400 ms, and only when the text is clearly not
 * a link. Every service the user allows, a handful of results; "See All in
 * Search" takes the query to the Search view for the rest.
 */
export function useInlineSearch(text: string, enabled: boolean): UseInlineSearch {
  const showAdult = useStore((s) => s.settings?.showAdultServices ?? false)
  const [status, setStatus] = useState<InlineSearchStatus>('idle')
  const [results, setResults] = useState<SearchResult[]>([])
  const [query, setQuery] = useState('')
  const generation = useRef(0)
  const q = text.trim()
  const searchable = enabled && q.length >= 2 && !isProbablyUrl(q) && !q.includes('\n')

  const run = (value: string): void => {
    if (value === query && status !== 'idle' && status !== 'error') return
    const gen = ++generation.current
    setQuery(value)
    setStatus('searching')
    void window.api
      .searchVideos(value, 'all', INLINE_RESULTS)
      .catch((err: unknown) => ({ ok: false as const, error: describeError(err), results: undefined }))
      .then((res) => {
        if (gen !== generation.current) return
        if (res.ok && res.results) {
          // Adult services only for those who switched them on, as in Search.
          const allowed = allowedSearchServices(SEARCH_ALL_SERVICES, showAdult)
          setResults(res.results.filter((r) => allowed.includes(r.service)).slice(0, INLINE_RESULTS))
          setStatus('done')
        } else {
          setResults([])
          setStatus('error')
        }
      })
  }

  useEffect(() => {
    if (!searchable) {
      generation.current++
      setStatus('idle')
      setResults([])
      setQuery('')
      return
    }
    const timer = window.setTimeout(() => run(q), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, searchable])

  return {
    status,
    results,
    query,
    runNow: () => {
      if (searchable) run(q)
    }
  }
}
