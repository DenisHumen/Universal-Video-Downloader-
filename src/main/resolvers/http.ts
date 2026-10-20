import { AsyncLocalStorage } from 'async_hooks'
import { net } from 'electron'
import { describeNetError, describeProxyRefusal, REQUEST_TIMED_OUT } from './neterror'
import { withProxyAuth } from '../services/proxy-auth'

/** A recent desktop Chrome UA — many sites gate on this. */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface RequestOptions {
  headers?: Record<string, string>
  /** Abort after this many ms (default 20s). */
  timeout?: number
  /** Stop reading after this many bytes — pages can be huge. */
  maxBytes?: number
  /** Abandons the request; defaults to the one `withSignal` scoped this call under. */
  signal?: AbortSignal
}

/*
  The cancel of the detect or download a resolver is working for.

  Site resolvers fetch through layers of helpers - a page, its API, the
  player behind it, each episode's tiers - and none of them took a signal, so
  a cancelled detect left them fetching until their own 20 s timeouts. Every
  helper taking one by hand would mean threading it through a dozen
  signatures shared with automation and the stream picker; instead the
  resolver entry points run under `withSignal`, and every request made on
  their behalf, however deep, picks it up here. An explicit `signal` wins.
*/
const scoped = new AsyncLocalStorage<AbortSignal | undefined>()

/** Run `fn` with every request it makes abandoned when `signal` aborts. */
export function withSignal<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return signal ? scoped.run(signal, fn) : fn()
}

/** What a request abandoned by its signal rejects with. */
export const REQUEST_CANCELED = 'Request canceled.'

/**
 * Wire `signal` to a request: `cancel` runs once when it aborts, and the
 * returned function detaches the listener when the request is done anyway.
 */
function onCancel(signal: AbortSignal | undefined, cancel: () => void): () => void {
  if (!signal) return () => undefined
  signal.addEventListener('abort', cancel, { once: true })
  return () => signal.removeEventListener('abort', cancel)
}

function request(
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  options: RequestOptions
): Promise<string> {
  const { headers = {}, timeout = 20_000, maxBytes = 8_000_000 } = options
  const signal = options.signal ?? scoped.getStore()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(REQUEST_CANCELED))
      return
    }
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach()
      fn()
    }

    let req: Electron.ClientRequest
    const timer = setTimeout(() => {
      finish(() => reject(new Error(REQUEST_TIMED_OUT)))
      try {
        req?.abort()
      } catch {
        /* already gone */
      }
    }, timeout)
    const detach = onCancel(signal, () => {
      finish(() => reject(new Error(REQUEST_CANCELED)))
      try {
        req?.abort()
      } catch {
        /* already gone */
      }
    })

    try {
      req = withProxyAuth(net.request({ url, method, redirect: 'follow' }), url)
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      return
    }

    req.setHeader('User-Agent', UA)
    req.setHeader('Accept-Language', 'en-US,en;q=0.9,ru;q=0.8')
    if (method === 'POST') {
      req.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
      req.setHeader('X-Requested-With', 'XMLHttpRequest')
    }
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    req.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status === 407) {
        finish(() => reject(describeProxyRefusal(url)))
        return
      }
      if (status >= 400) {
        finish(() => reject(new Error(`HTTP ${status}`)))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        if (size >= maxBytes) return
        size += chunk.length
        chunks.push(chunk)
      })
      response.on('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf-8'))))
      response.on('error', (err: Error) => finish(() => reject(describeNetError(err, url))))
    })
    req.on('error', (err) => finish(() => reject(describeNetError(err, url))))
    if (body) req.write(body)
    req.end()
  })
}

export function fetchText(
  url: string,
  headers: Record<string, string> = {},
  options: Omit<RequestOptions, 'headers'> = {}
): Promise<string> {
  return request(url, 'GET', undefined, { ...options, headers })
}

export interface BinaryResponse {
  body: Buffer
  contentType: string
}

/** Fetch raw bytes — used for images, which must not be decoded as text. */
export function fetchBinary(
  url: string,
  headers: Record<string, string> = {},
  options: Omit<RequestOptions, 'headers'> = {}
): Promise<BinaryResponse> {
  const { timeout = 15_000, maxBytes = 6_000_000 } = options
  const signal = options.signal ?? scoped.getStore()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(REQUEST_CANCELED))
      return
    }
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach()
      fn()
    }

    let req: Electron.ClientRequest
    const timer = setTimeout(() => {
      finish(() => reject(new Error(REQUEST_TIMED_OUT)))
      try {
        req?.abort()
      } catch {
        /* already gone */
      }
    }, timeout)
    const detach = onCancel(signal, () => {
      finish(() => reject(new Error(REQUEST_CANCELED)))
      try {
        req?.abort()
      } catch {
        /* already gone */
      }
    })

    try {
      req = withProxyAuth(net.request({ url, method: 'GET', redirect: 'follow' }), url)
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      return
    }

    req.setHeader('User-Agent', UA)
    req.setHeader('Accept', 'image/avif,image/webp,image/*,*/*;q=0.8')
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    req.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status === 407) {
        finish(() => reject(describeProxyRefusal(url)))
        return
      }
      if (status >= 400) {
        finish(() => reject(new Error(`HTTP ${status}`)))
        return
      }
      const rawType = response.headers['content-type']
      const contentType = (Array.isArray(rawType) ? rawType[0] : rawType) || 'image/jpeg'
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        if (size >= maxBytes) return
        size += chunk.length
        chunks.push(chunk)
      })
      response.on('end', () =>
        finish(() => resolve({ body: Buffer.concat(chunks), contentType: contentType.split(';')[0] }))
      )
      response.on('error', (err: Error) => finish(() => reject(describeNetError(err, url))))
    })
    req.on('error', (err) => finish(() => reject(describeNetError(err, url))))
    req.end()
  })
}

export function netPost(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  options: Omit<RequestOptions, 'headers'> = {}
): Promise<string> {
  return request(url, 'POST', body, { ...options, headers })
}

/** First capture group of `re` in `html`, or undefined. */
export function pick(re: RegExp, html: string): string | undefined {
  const m = html.match(re)
  return m ? m[1] : undefined
}

/**
 * Markup down to plain text, for titles and labels scraped off a page.
 *
 * Control characters go too. These strings become download titles and file
 * names, and a NUL in an argument makes `spawn` throw instead of starting the
 * engine.
 */
export function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** Turn a possibly relative/protocol-relative URL into an absolute one. */
export function absoluteUrl(candidate: string, base: string): string | undefined {
  const raw = candidate.trim()
  if (!raw) return undefined
  if (raw.startsWith('//')) return `https:${raw}`
  try {
    return new URL(raw, base).toString()
  } catch {
    return undefined
  }
}

export function slugToTitle(path: string): string {
  const slug = path.split('/').filter(Boolean).pop() || path
  return slug
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function b64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}
