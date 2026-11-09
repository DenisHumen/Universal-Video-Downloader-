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
