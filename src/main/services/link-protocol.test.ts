import { describe, expect, it, vi } from 'vitest'
import { claimLinkScheme, NO_PROTOCOL_ENV, shouldClaimLinkScheme } from './link-protocol'

const installed = { packaged: true, platform: 'win32' as NodeJS.Platform, env: {} as NodeJS.ProcessEnv }
const registrar = (already = false) => ({
  isDefaultProtocolClient: vi.fn(() => already),
  setAsDefaultProtocolClient: vi.fn(() => true)
})

describe('claiming uvd: links', () => {
  it.each([
    ['a development run', { ...installed, packaged: false }],
    ['a development run on a Mac', { ...installed, packaged: false, platform: 'darwin' as NodeJS.Platform }],
    ['a test, by NODE_ENV', { ...installed, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv }],
    ['a test, by vitest', { ...installed, env: { VITEST: 'true' } as NodeJS.ProcessEnv }],
    ['a packaged build run by a check', { ...installed, env: { [NO_PROTOCOL_ENV]: '1' } as NodeJS.ProcessEnv }],
    ['Linux, where the package says it', { ...installed, platform: 'linux' as NodeJS.Platform }],
    ['an AppImage', { ...installed, platform: 'linux' as NodeJS.Platform, env: { APPIMAGE: '/home/me/app.AppImage' } as NodeJS.ProcessEnv }]
  ])('never touches the system in %s', (_name, state) => {
    const app = registrar()
    expect(shouldClaimLinkScheme(state)).toBe(false)
    expect(claimLinkScheme(app, state)).toBe(false)
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('is what this very test run counts as', () => {
    const app = registrar()
    expect(claimLinkScheme(app, { packaged: true, platform: 'win32', env: process.env })).toBe(false)
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('asks an installed app, with nothing added to the command', () => {
    const app = registrar()
    expect(claimLinkScheme(app, installed)).toBe(true)
    expect(claimLinkScheme(app, { ...installed, platform: 'darwin' })).toBe(true)
    expect(app.setAsDefaultProtocolClient.mock.calls).toEqual([['uvd'], ['uvd']])
  })

  it('leaves the entry alone when it already leads here', () => {
    const app = registrar(true)
    expect(claimLinkScheme(app, installed)).toBe(false)
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})
