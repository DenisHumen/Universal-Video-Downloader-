import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  languages: [] as string[],
  setUserAgent: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => h.languages },
  session: {
    fromPartition: () => ({
      setUserAgent: h.setUserAgent,
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      on: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() }
    })
  }
}))
vi.mock('../../services/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }))

/*
  The package keeps three of Chromium's language files, and Chromium builds this
  header from the one it found. Without the system's list, a site in the built-in
  browser is asked for English on a German system.
*/
describe('the languages the built-in browser asks sites for', () => {
  beforeEach(() => {
    vi.resetModules()
    h.setUserAgent.mockClear()
  })

  it('are the ones the system prefers, in its order', async () => {
    h.languages = ['de-DE', 'de', 'en-GB']
    const { browsingSession } = await import('./capture')
    browsingSession()
    expect(h.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Mozilla/5.0'), 'de-DE,de,en-GB')
  })

  it('are left to Chromium when the system does not say', async () => {
    h.languages = []
    const { browsingSession } = await import('./capture')
    browsingSession()
    expect(h.setUserAgent).not.toHaveBeenCalled()
  })
})

/*
  The noise filter. It matched anywhere in an address, cancelled pages the
  person went to, and took "Sign in with Facebook" with it in the one browser
  where signing in is the point.
*/
describe('which requests are dropped as noise', () => {
  const blocks = async (...args: [string, string, boolean]): Promise<boolean> =>
    (await import('./capture')).blocksRequest(...args)

  it('drops a tracker a page loads', async () => {
    expect(await blocks('https://www.google-analytics.com/analytics.js', 'script', false)).toBe(true)
    expect(await blocks('https://analytics.site.tv/collect', 'xhr', true)).toBe(true)
  })

  it('goes by the host, not by a word in the address', async () => {
    expect(await blocks('https://site.tv/watch?from=analytics.report', 'xhr', false)).toBe(false)
    expect(await blocks('https://cdn.site.tv/doubleclick/player.js', 'script', false)).toBe(false)
  })

  it('never cancels a page the person navigated to', async () => {
    expect(await blocks('https://analytics.google.com/', 'mainFrame', false)).toBe(false)
  })

  it('lets the Facebook sign-in load in the browser someone is looking at, and not in a detection window', async () => {
    expect(await blocks('https://connect.facebook.net/en_US/sdk.js', 'script', false)).toBe(false)
    expect(await blocks('https://connect.facebook.net/en_US/sdk.js', 'script', true)).toBe(true)
  })
})
