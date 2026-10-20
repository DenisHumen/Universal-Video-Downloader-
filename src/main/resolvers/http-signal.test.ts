import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

/** Requests made so far; each one hangs until it is abandoned. */
const made = vi.hoisted(() => [] as { abort: () => void }[])
vi.mock('electron', () => ({
  net: {
    request: () => {
      const req = Object.assign(new EventEmitter(), {
        setHeader: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        abort: vi.fn()
      })
      made.push(req)
      return req
    }
  }
}))
vi.mock('../services/proxy-auth', () => ({ withProxyAuth: <T>(req: T): T => req }))

const { fetchText, netPost, REQUEST_CANCELED, withSignal } = await import('./http')

describe('withSignal', () => {
  it('abandons a request made deep inside the scoped call', async () => {
    const controller = new AbortController()
    const before = made.length
    const nested = async (): Promise<string> => {
      await Promise.resolve()
      return fetchText('https://site.test/page')
    }
    const pending = withSignal(controller.signal, nested)
    await vi.waitFor(() => expect(made).toHaveLength(before + 1))
    controller.abort()
    await expect(pending).rejects.toThrow(REQUEST_CANCELED)
    expect(made[before].abort).toHaveBeenCalled()
  })

  it('never starts a request once the signal has fired', async () => {
    const controller = new AbortController()
    controller.abort()
    const before = made.length
    await expect(
      withSignal(controller.signal, () => netPost('https://site.test/api', 'a=1'))
    ).rejects.toThrow(REQUEST_CANCELED)
    expect(made).toHaveLength(before)
  })

  it('prefers a signal passed to the request itself', async () => {
    const own = new AbortController()
    const pending = withSignal(new AbortController().signal, () =>
      fetchText('https://site.test/own', {}, { signal: own.signal })
    )
    own.abort()
    await expect(pending).rejects.toThrow(REQUEST_CANCELED)
  })
})
