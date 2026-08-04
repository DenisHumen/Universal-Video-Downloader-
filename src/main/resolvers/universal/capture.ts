import { session, type Session, type OnBeforeSendHeadersListenerDetails } from 'electron'
import { UA } from '../http'
import { scoreUrl, type MediaCandidate } from './candidates'

/**
 * Network media capture for a session.
 *
 * Electron allows exactly one listener per `webRequest` event per session, so
 * the hidden sniffer and the visible built-in browser — which share a session
 * on purpose, to share cookies and logins — cannot each install their own.
 * This module owns the hooks and fans results out to every subscriber,
 * installing on the first attach and removing on the last detach.
 */

/** The session used by both the hidden sniffer and the in-app browser. */
export const BROWSING_PARTITION = 'persist:uvd-browser'

export function browsingSession(): Session {
  return session.fromPartition(BROWSING_PARTITION)
}

/** Requests that only add noise (and slow the page down). */
const BLOCKED =
  /(doubleclick|googlesyndication|google-analytics|googletagmanager|analytics\.|adservice|adsystem|scorecardresearch|popads|propellerads|exoclick|juicyads|trafficjunky|hotjar|mc\.yandex|facebook\.net|connect\.facebook)/i

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|flv)(\?|#|$)/i
const MEDIA_TYPE =
  /(application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)|video\/(mp4|webm|x-flv|quicktime|mp2t))/i

const INTERESTING_HEADERS = ['Referer', 'Origin', 'Cookie', 'User-Agent', 'Authorization']

export type CaptureSink = (candidate: MediaCandidate) => void

interface Installation {
  sinks: Set<CaptureSink>
  recentHeaders: Map<string, Record<string, string>>
}

const installations = new Map<Session, Installation>()

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string {
  if (!headers) return ''
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v.join('; ') : String(v)
  }
  return ''
}

function pickHeaders(raw: OnBeforeSendHeadersListenerDetails['requestHeaders']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const wanted of INTERESTING_HEADERS) {
    const value = headerValue(raw, wanted.toLowerCase())
    if (value) out[wanted] = value
  }
  if (!out['User-Agent']) out['User-Agent'] = UA
  return out
}

function install(ses: Session): Installation {
  const state: Installation = { sinks: new Set(), recentHeaders: new Map() }

  const emit = (url: string, headers: Record<string, string>): void => {
    const { kind, score } = scoreUrl(url, 12)
    if (!score) return
    const candidate: MediaCandidate = { url, kind, score, headers, source: 'network' }
    for (const sink of state.sinks) {
      try {
        sink(candidate)
      } catch {
        /* a broken subscriber must not stop the others */
      }
    }
  }

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: BLOCKED.test(details.url) })
  })

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = pickHeaders(details.requestHeaders)
    if (state.recentHeaders.size > 400) state.recentHeaders.clear()
    state.recentHeaders.set(details.url, headers)
    if (MEDIA_EXT.test(details.url)) emit(details.url, headers)
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const type = headerValue(details.responseHeaders, 'content-type')
    if (MEDIA_TYPE.test(type)) {
      emit(details.url, state.recentHeaders.get(details.url) ?? { 'User-Agent': UA })
    }
    callback({ responseHeaders: details.responseHeaders })
  })

  installations.set(ses, state)
  return state
}

function uninstall(ses: Session): void {
  ses.webRequest.onBeforeRequest(null)
  ses.webRequest.onBeforeSendHeaders(null)
  ses.webRequest.onHeadersReceived(null)
  installations.delete(ses)
}

/** Subscribe to media seen on `ses`. Returns an unsubscribe function. */
export function attachCapture(ses: Session, sink: CaptureSink): () => void {
  const state = installations.get(ses) ?? install(ses)
  state.sinks.add(sink)
  let detached = false
  return () => {
    if (detached) return
    detached = true
    state.sinks.delete(sink)
    if (state.sinks.size === 0) uninstall(ses)
  }
}
