import { net } from 'electron'
import { log } from '../log'

/**
 * Telling the user an episode arrived.
 *
 * A plain HTTPS request to the Bot API through Electron's own `net`, the same
 * way the resolvers talk to sites. No webhook — that is for *receiving*
 * updates, and this bot only speaks. No client library for four fields of JSON.
 *
 * The file never travels: a bot may send at most 50 MB and an episode is
 * several hundred. The message says what arrived and where it was put, which is
 * the useful half anyway — the file is on the share, which was the point.
 */

const API = 'https://api.telegram.org'

/** Telegram's own limits. Exceeding either is a rejected message, not a truncated one. */
const MAX_TEXT = 4096
const MAX_CAPTION = 1024

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly kind: 'token' | 'chat' | 'network' | 'unknown'
  ) {
    super(message)
    this.name = 'TelegramError'
  }
}

/**
 * HTML, not MarkdownV2.
 *
 * Three characters to escape rather than roughly eighteen — and the eighteen
 * include `.`, `-`, `!` and brackets, every one of which turns up in an
 * ordinary series title. One unescaped character makes Telegram reject the
 * whole message, so the format with three rules is the one that keeps working
 * on titles nobody anticipated.
 *
 * Applied to each value as it goes in, never to the finished string, or the
 * tags would be escaped along with it.
 */
export function esc(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Reply {
  ok: boolean
  result?: { message_id?: number }
  error_code?: number
  description?: string
}

function call(token: string, method: string, body: Record<string, unknown>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const request = net.request({ method: 'POST', url: `${API}/bot${token}/${method}` })
    request.setHeader('Content-Type', 'application/json')

    const timer = setTimeout(() => {
      reject(new TelegramError('Telegram did not answer in time.', 'network'))
      try {
        request.abort()
      } catch {
        /* already gone */
      }
    }, 20_000)

    request.on('response', (response) => {
      let data = ''
      response.on('data', (chunk: Buffer) => (data += chunk.toString()))
      response.on('end', () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(data) as Reply)
        } catch {
          reject(new TelegramError('Telegram sent something that was not an answer.', 'unknown'))
        }
      })
      response.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new TelegramError(err.message, 'network'))
      })
    })
    request.on('error', (err) => {
      clearTimeout(timer)
      reject(new TelegramError(err.message, 'network'))
    })
    request.end(payload)
  })
}

/** Telegram answers a refusal in a readable form, unlike the SMB library. */
function check(reply: Reply): void {
  if (reply.ok) return
  const description = reply.description ?? 'Telegram refused the message.'
  if (reply.error_code === 401) {
    throw new TelegramError('That bot token is not valid.', 'token')
  }
  if (reply.error_code === 400 && /chat not found/i.test(description)) {
    throw new TelegramError(
      'That chat id is not one this bot can write to. Send the bot a message first.',
      'chat'
    )
  }
  if (reply.error_code === 403) {
    throw new TelegramError('The bot has been blocked by that chat.', 'chat')
  }
  throw new TelegramError(description, 'unknown')
}

/**
 * One message at a time, with a gap.
 *
 * Telegram allows roughly one message per second to a single chat, and a check
 * that finds four new episodes at once would otherwise arrive as a burst.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100))
  )
  return next
}

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

export async function sendMessage(token: string, chatId: string, html: string): Promise<void> {
  await serialise(async () => {
    const reply = await call(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: clamp(html, MAX_TEXT)
    })
    check(reply)
  })
}

/**
 * A message with the series poster, falling back to a plain one.
 *
 * The caption limit is a quarter of the message limit, and a poster URL can
 * fail for reasons that have nothing to do with the notification being worth
 * sending — so a photo that will not go through must not cost the user the news
 * that their episode arrived.
 */
export async function sendNotification(
  token: string,
  chatId: string,
  html: string,
  photoUrl?: string
): Promise<void> {
  if (photoUrl && html.length <= MAX_CAPTION) {
    try {
      await serialise(async () => {
        const reply = await call(token, 'sendPhoto', {
          chat_id: chatId,
          parse_mode: 'HTML',
          photo: photoUrl,
          caption: html
        })
        check(reply)
      })
      return
    } catch (err) {
      if (err instanceof TelegramError && (err.kind === 'token' || err.kind === 'chat')) throw err
      log.warn('notify', 'The poster could not be sent; sending the text alone', {
        why: err instanceof Error ? err.message : String(err)
      })
    }
  }
  await sendMessage(token, chatId, html)
}

/** Confirm a token and chat id, for the "send a test message" button. */
export async function sendTest(token: string, chatId: string): Promise<string> {
  const me = await call(token, 'getMe', {})
  check(me)
  const name = (me.result as { username?: string } | undefined)?.username
  await sendMessage(
    token,
    chatId,
    '<b>Universal Video Downloader</b>\nNotifications are working.'
  )
  return name ? `Connected as @${name}.` : 'Connected.'
}

export interface EpisodeNews {
  series: string
  season: number
  episode: number
  translator?: string
  quality?: string
  /** Where it ended up, if it was uploaded. */
  remotePath?: string
  bytes?: number
  seconds?: number
  posterUrl?: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

const size = (bytes?: number): string =>
  bytes ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : ''

const took = (seconds?: number): string => {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m} min ${s} s` : `${s} s`
}

/** What a "new episode" notification looks like. */
export function composeEpisodeNews(news: EpisodeNews): string {
  const lines = [
    `🎬 <b>${esc(news.series)}</b> — S${pad(news.season)}E${pad(news.episode)}`
  ]
  const sub = [news.translator, news.quality].filter(Boolean).join(' · ')
  if (sub) lines.push(`<i>${esc(sub)}</i>`)
  if (news.remotePath) {
    lines.push('', `Uploaded to <code>${esc(news.remotePath)}</code>`)
  }
  const facts = [size(news.bytes), took(news.seconds)].filter(Boolean).join(' · ')
  if (facts) lines.push(esc(facts))
  return lines.join('\n')
}

/** What a failure looks like. Worth telling, since nobody is watching. */
export function composeFailure(series: string, season: number, episode: number, why: string): string {
  return [
    `⚠️ <b>${esc(series)}</b> — S${pad(season)}E${pad(episode)}`,
    '',
    esc(why)
  ].join('\n')
}
