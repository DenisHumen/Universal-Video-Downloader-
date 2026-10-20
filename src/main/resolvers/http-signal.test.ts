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

const { fetchText, netPost, REQUEST_CANCELED, unscoped, withSignal } = await import('./http')
const { shortLivedCache } = await import('./sites/yummyani')

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

describe('unscoped', () => {
  it("keeps a shared load running when the caller that started it cancels", async () => {
    const first = new AbortController()
    const before = made.length
    const cache = shortLivedCache<string>(60_000, 4)
    const load = (): Promise<string> => fetchText('https://site.test/shared')
    const a = withSignal(first.signal, () => cache.get('k', load))
    const b = withSignal(new AbortController().signal, () => cache.get('k', load))
    await vi.waitFor(() => expect(made).toHaveLength(before + 1))
    first.abort()
    await Promise.resolve()
    expect(made[before].abort).not.toHaveBeenCalled()
    // Both callers still share the one pending request.
    expect(a).toBe(b)
  })

  it('leaves nothing scoped inside it', async () => {
    const controller = new AbortController()
    const pending = withSignal(controller.signal, () => unscoped(() => fetchText('https://site.test/free')))
    controller.abort()
    let settled = false
    pending.then(() => (settled = true), () => (settled = true))
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
  })
})
