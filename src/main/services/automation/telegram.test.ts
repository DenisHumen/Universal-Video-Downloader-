import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeCheckFailure, composeFailure } from './telegram'

/** What the pretend Bot API answers, one entry per request: a reply, or a transport failure. */
const h = vi.hoisted(() => ({ answers: [] as unknown[], urls: [] as string[] }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  return {
    net: {
      request: ({ url }: { url: string }) => {
        const request = Object.assign(new EventEmitter(), {
          setHeader: () => undefined,
          abort: () => undefined,
          end: () => {
            h.urls.push(url)
            const answer = h.answers.shift()
            setTimeout(() => {
              if (answer instanceof Error) {
                request.emit('error', answer)
                return
              }
              const response = new EventEmitter()
              request.emit('response', response)
              response.emit('data', Buffer.from(JSON.stringify(answer)))
              response.emit('end')
            }, 0)
          }
        })
        return request
      }
    }
  }
})
vi.mock('../log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

/*
  Telegram rejects the whole message over one unescaped `<` or `&`, and both
  turn up in series titles and in the text of an exception. The message that
  says checks keep failing is the one that must not itself fail to send.
*/
describe('composeCheckFailure', () => {
  it('escapes the title and the reason', () => {
    const html = composeCheckFailure('Tom & Jerry <remastered>', 3, 'Unexpected token < in JSON')
    expect(html).toContain('Tom &amp; Jerry &lt;remastered&gt;')
    expect(html).toContain('Unexpected token &lt; in JSON')
    expect(html).not.toContain('<remastered>')
  })

  it('keeps its own markup intact', () => {
    expect(composeCheckFailure('Show', 3, 'gone')).toMatch(/^⚠️ <b>Show<\/b>/)
  })

  it('says how many checks failed', () => {
    expect(composeCheckFailure('Show', 3, 'gone')).toContain('last 3 checks failed')
  })
})

/*
  An episode is now sent to Telegram once, when it is given up on, rather than
  at every failed go. That one message has to say nothing will try again.
*/
describe('composeFailure', () => {
  it('says it gave up after several goes, and where to try again', () => {
    const html = composeFailure('Show', 1, 4, 'Could not reach 192.168.1.10', 3)
    expect(html).toContain('S01E04')
    expect(html).toContain('Failed 3 times')
    expect(html).toContain('watch screen')
  })

  it('says nothing about goes for a single one', () => {
    expect(composeFailure('Show', 1, 4, 'gone')).not.toContain('times')
  })
})

/*
  A burst of messages - every episode of a dub that was taken down, failing at
  once - ran into Telegram's limit of about twenty a minute per group, and the
  429s, which say how long to wait, were never waited out: the tail of the
  burst was simply lost.
*/
describe('sending', () => {
  type Telegram = typeof import('./telegram')
  let telegram: Telegram
  const TOKEN = '123456789:AAexample'
  const tooMany = (seconds?: number): unknown => ({
    ok: false,
    error_code: 429,
    description: 'Too Many Requests: retry after 3',
    parameters: seconds === undefined ? undefined : { retry_after: seconds }
  })

  beforeEach(async () => {
    vi.useFakeTimers()
    h.answers = []
    h.urls = []
    // The send queue is module state; each case starts with an empty one.
    vi.resetModules()
    telegram = await import('./telegram')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits as long as a 429 asks, then sends once more', async () => {
    h.answers = [tooMany(3), { ok: true }]
    const sent = telegram.sendMessage(TOKEN, '100000000', 'hello')

    await vi.advanceTimersByTimeAsync(2900)
    expect(h.urls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(200)
    await sent
    expect(h.urls).toHaveLength(2)
  })

  it('tries again only once, and then says it was rate-limited', async () => {
    h.answers = [tooMany(1), tooMany(1), { ok: true }]
    const sent = telegram.sendMessage(TOKEN, '100000000', 'hello').catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(5000)
    const err = (await sent) as InstanceType<Telegram['TelegramError']>
    expect(h.urls).toHaveLength(2)
    expect(err.kind).toBe('rate')
    expect(err.message).toContain('rate-limiting')
  })

  // Telegram has asked for minutes; the run, and the messages queued behind it, would stall.
  it('waits half a minute at most', async () => {
    h.answers = [tooMany(600), { ok: true }]
    const sent = telegram.sendMessage(TOKEN, '100000000', 'hello')

    await vi.advanceTimersByTimeAsync(30_100)
    await sent
    expect(h.urls).toHaveLength(2)
  })

  // A poster Telegram could not fetch must not cost the news that the episode arrived.
  it('sends the text alone when Telegram cannot use the poster', async () => {
    h.answers = [
      { ok: false, error_code: 400, description: 'Bad Request: failed to get HTTP URL content' },
      { ok: true }
    ]
    const sent = telegram.sendNotification(TOKEN, '100000000', 'hello', 'https://example.com/poster.jpg')

    await vi.advanceTimersByTimeAsync(5000)
    await sent
    expect(h.urls.map((url) => url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage'])
  })

  // The plain message would be refused the same way; trying it only doubles the noise.
  it('does not fall back for a bot the chat has blocked', async () => {
    h.answers = [{ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }]
    const sent = telegram
      .sendNotification(TOKEN, '100000000', 'hello', 'https://example.com/poster.jpg')
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(5000)
    expect(((await sent) as { kind: string }).kind).toBe('chat')
    expect(h.urls).toHaveLength(1)
  })

  it('does not fall back to the text alone when the photo was rate-limited', async () => {
    h.answers = [tooMany(1), tooMany(1), { ok: true }]
    const sent = telegram
      .sendNotification(TOKEN, '100000000', 'hello', 'https://example.com/poster.jpg')
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(((await sent) as { kind: string }).kind).toBe('rate')
    expect(h.urls.every((url) => url.endsWith('/sendPhoto'))).toBe(true)
  })

  /*
    The message may have gone through before the connection dropped, and a
    second go would post it twice. The error used to be `net::ERR_...` as is.
  */
  it('never repeats after a dropped connection, and says where it could not reach', async () => {
    h.answers = [new Error('net::ERR_CONNECTION_RESET'), { ok: true }]
    const sent = telegram.sendMessage(TOKEN, '100000000', 'hello').catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(60_000)
    const err = (await sent) as InstanceType<Telegram['TelegramError']>
    expect(h.urls).toHaveLength(1)
    expect(err.kind).toBe('network')
    expect(err.message).toContain('api.telegram.org')
    expect(err.message).toContain('ERR_CONNECTION_RESET')
    // The request's URL carries the token; the message must not.
    expect(err.message).not.toContain(TOKEN)
  })
})
