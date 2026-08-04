import { net } from 'electron'

/** A recent desktop Chrome UA — many sites gate on this. */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface RequestOptions {
  headers?: Record<string, string>
  /** Abort after this many ms (default 20s). */
  timeout?: number
  /** Stop reading after this many bytes — pages can be huge. */
  maxBytes?: number
}

function request(
  url: string,
  method: 'GET' | 'POST',
  body: string | undefined,
  options: RequestOptions
): Promise<string> {
  const { headers = {}, timeout = 20_000, maxBytes = 8_000_000 } = options
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    let req: Electron.ClientRequest
    const timer = setTimeout(() => {
      finish(() => reject(new Error('Request timed out')))
      try {
        req?.abort()
      } catch {
        /* already gone */
      }
    }, timeout)

    try {
      req = net.request({ url, method, redirect: 'follow' })
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
      response.on('error', (err: Error) => finish(() => reject(err)))
    })
    req.on('error', (err) => finish(() => reject(err)))
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

export function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
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
