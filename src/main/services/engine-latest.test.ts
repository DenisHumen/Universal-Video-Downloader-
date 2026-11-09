import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { request: vi.fn() } }))
vi.mock('./ytdlp', () => ({ getVersion: vi.fn() }))
vi.mock('./proxy-auth', () => ({ withProxyAuth: (r: unknown) => r }))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { engineFreshness, forgetLatest, tagFromUrl } from './engine-latest'

const version = (v?: string) => async (): Promise<string | undefined> => v

beforeEach(() => forgetLatest())

describe('the latest engine release', () => {
  it('is read from where the releases page redirects to', () => {
    expect(tagFromUrl('https://github.com/yt-dlp/yt-dlp/releases/tag/2026.03.17')).toBe('2026.03.17')
    expect(tagFromUrl('https://github.com/login')).toBeUndefined()
  })

  it('says older when it is', async () => {
    expect(await engineFreshness(async () => '2026.03.17', version('2026.01.01'))).toEqual({
      current: '2026.01.01',
      latest: '2026.03.17',
      older: true
    })
  })

  it('makes no offer when the engine is current', async () => {
    expect((await engineFreshness(async () => '2026.03.17', version('2026.03.17'))).older).toBe(false)
  })

  it('makes no offer when it cannot find out', async () => {
    expect((await engineFreshness(async () => undefined, version('2026.01.01'))).older).toBe(false)
    forgetLatest()
    expect((await engineFreshness(() => Promise.reject(new Error('offline')), version('2026.01.01'))).older).toBe(false)
    forgetLatest()
    expect((await engineFreshness(async () => '2026.03.17', version(undefined))).older).toBe(false)
  })

  it('asks once an hour, however many rows have failed, but reads this engine each time', async () => {
    const ask = vi.fn(async () => '2026.03.17')
    const at = 1_000_000
    await engineFreshness(ask, version('2026.01.01'), at)
    expect((await engineFreshness(ask, version('2026.03.17'), at + 60_000)).older).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    await engineFreshness(ask, version('2026.03.17'), at + 3_600_000)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('tries again sooner after failing to find out', async () => {
    const ask = vi.fn(async (): Promise<string | undefined> => undefined)
    await engineFreshness(ask, version('2026.01.01'), 0)
    await engineFreshness(ask, version('2026.01.01'), 60_000)
    expect(ask).toHaveBeenCalledTimes(1)
    await engineFreshness(ask, version('2026.01.01'), 300_000)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
