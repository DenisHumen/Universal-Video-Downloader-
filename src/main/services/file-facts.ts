import { spawn } from 'child_process'
import { ffmpegPath, parseDuration } from './ffmpeg'
import { groupSpawnOptions, killTree } from './process'

/**
 * A poster and a length for a plain file on the web.
 *
 * The engine reads neither out of a file it is only given a link to, so a direct
 * .mp4 got a card with an empty picture, no length and a trim editor with nothing
 * to work from. ffmpeg can read both from the start of the file, in about the
 * time of a page load. This runs inside a detect, so it has a hard limit: what it
 * has by then is what the card gets, and a slow host costs a poster and no more.
 */

/** What a detect will wait for this. Past it the card is worth more than its picture. */
const BUDGET_MS = 1500
/** A small jpeg for a card; a frame bigger than this is not going into history.json. */
const MOST_BYTES = 64 * 1024

export interface FileFacts {
  duration?: number
  /** A `data:` address, since the file's own address serves no picture. */
  poster?: string
}

/** The extractors that mean "no site knowledge, just a file or a tag on a page". */
const NO_SITE = /^(generic|html5mediaembed)$/i

export interface FileProbeQuestion {
  extractor?: string
  /** The one format's address and protocol. */
  formats?: { url?: string; protocol?: string }[]
  duration?: number
  thumbnail?: string
  isLive?: boolean
  /** Headers the file needs, or a proxy it must go through: ffmpeg would ask differently from the engine. */
  needsAccess: boolean
}

/**
 * The address worth asking about, or undefined. One format over plain http: not a
 * manifest, which is neither cheap nor one file, and never a request around a
 * proxy the person set, which would tell the site where they really are.
 */
export function plainFileAddress(q: FileProbeQuestion): string | undefined {
  if (q.needsAccess || q.isLive || !NO_SITE.test(q.extractor ?? '')) return undefined
  if (q.duration && q.thumbnail) return undefined
  if (q.formats?.length !== 1) return undefined
  const [only] = q.formats
  return only.url && /^https?:\/\//i.test(only.url) && /^https?$/i.test(only.protocol ?? '') ? only.url : undefined
}

/**
 * ffmpeg's arguments: one small frame a second in, written to stdout. The
 * whitelist keeps the file itself from sending it anywhere but the web, and the
 * length comes from the report it prints on the way.
 */
export function fileFactsArgs(url: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-protocol_whitelist',
    'http,https,tcp,tls,crypto',
    '-rw_timeout',
    String(BUDGET_MS * 1000),
    '-ss',
    '1',
    '-i',
    url,
    '-an',
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2',
    '-q:v',
    '6',
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    'pipe:1'
  ]
}

export function fileFacts(url: string, signal?: AbortSignal, budgetMs = BUDGET_MS): Promise<FileFacts> {
  const bin = ffmpegPath()
  if (!bin || signal?.aborted) return Promise.resolve({})
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, fileFactsArgs(url), { windowsHide: true, ...groupSpawnOptions() })
    } catch {
      resolve({})
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let report = ''
    let settled = false
    const finish = (complete: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      const frame = Buffer.concat(chunks)
      resolve({
        duration: parseDuration(report),
        // Only a whole frame: one cut off by the limit draws as half a picture.
        poster: complete && frame.length > 0 && size <= MOST_BYTES ? `data:image/jpeg;base64,${frame.toString('base64')}` : undefined
      })
    }
    const stop = (): void => {
      killTree(child)
      finish(false)
    }
    const timer = setTimeout(stop, budgetMs)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MOST_BYTES) chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      report = (report + chunk.toString()).slice(-8000)
    })
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}
