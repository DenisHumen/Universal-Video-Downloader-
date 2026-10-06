import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchVideos } from './search'
import type { SearchResult } from '@shared/types'

/*
  The engine is a stand-in that answers every search with one titled entry,
  and records what it was asked to search; the API-backed services are
  stand-ins too. What is real is the routing: which services a search goes to,
  and what it refuses.
*/
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn
}))
const settings = vi.hoisted(() => ({ showAdultServices: false }))
vi.mock('./settings', () => ({ getSettings: () => settings }))
vi.mock('./ytdlp', () => ({
  ytdlpBinaryPath: () => 'yt-dlp',
  ytdlpSpawnOptions: () => ({ windowsHide: true, env: {} }),
  engineUnavailable: async () => undefined
}))

const result = (service: SearchResult['service']): SearchResult => ({
  id: service,
  title: `${service} result`,
  url: `https://example.com/${service}`,
  service
})
vi.mock('../resolvers', () => ({ searchYummyani: async () => [result('yummyani')] }))
const searchDailymotion = vi.hoisted(() => vi.fn())
const searchNiconico = vi.hoisted(() => vi.fn())
const searchBilibili = vi.hoisted(() => vi.fn())
vi.mock('./search-apis', () => ({ searchDailymotion, searchNiconico, searchBilibili }))

/** What the engine was asked to search, one target per run. */
const engineTargets = (): string[] => spawn.mock.calls.map(([, args]) => (args as string[]).at(-1)!)

beforeEach(() => {
  settings.showAdultServices = false
  spawn.mockReset()
  spawn.mockImplementation((_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough()
    })
    const target = args.at(-1)!
    child.stdout.end(
      JSON.stringify({ entries: [{ id: target, title: 'engine result', url: `https://example.com/e/${target}` }] })
    )
    setImmediate(() => child.emit('close', 0))
    return child
  })
  searchDailymotion.mockReset().mockResolvedValue([result('dailymotion')])
  searchNiconico.mockReset().mockResolvedValue([result('niconico')])
  searchBilibili.mockReset().mockResolvedValue({ ok: true, results: [result('bilibili')] })
})

describe('searchVideos', () => {
  it('leaves adult sites out of an all-services search while the setting is off', async () => {
    const res = await searchVideos('lofi', 'all')
    expect(res.ok).toBe(true)
    expect(engineTargets().some((t) => t.includes('pornhub'))).toBe(false)
    expect(engineTargets().some((t) => t.startsWith('ytsearch'))).toBe(true)
  })

  it('includes them once the user turns the setting on', async () => {
    settings.showAdultServices = true
    await searchVideos('lofi', 'all')
    expect(engineTargets().some((t) => t.includes('pornhub.com'))).toBe(true)
  })

  it('refuses an adult service asked for by name while the setting is off', async () => {
    const res = await searchVideos('lofi', 'pornhub')
    expect(res).toMatchObject({ ok: false, errorCode: 'adultHidden' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('searches Dailymotion, Niconico and Bilibili through their APIs, not the engine', async () => {
    for (const service of ['dailymotion', 'niconico', 'bilibili'] as const) {
      const res = await searchVideos('naruto 1', service)
      expect(res.results?.[0].service).toBe(service)
    }
    expect(spawn).not.toHaveBeenCalled()
    expect(searchDailymotion).toHaveBeenCalledWith('naruto 1', 12)
  })

  it('says a host that cannot be reached in a code the window translates', async () => {
    searchNiconico.mockRejectedValue(new Error('Request timed out'))
    expect(await searchVideos('lofi', 'niconico')).toMatchObject({ ok: false, errorCode: 'timeout' })
  })

  it('does not quote a JSON parser at the user', async () => {
    searchDailymotion.mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0'))
    expect(await searchVideos('lofi', 'dailymotion')).toEqual({
      ok: false,
      error: 'Could not parse search results.'
    })
  })

  it('still answers an all-services search when one API fails', async () => {
    searchDailymotion.mockRejectedValue(new Error('HTTP 503'))
    const res = await searchVideos('lofi', 'all')
    expect(res.ok).toBe(true)
    expect(res.results?.some((r) => r.service === 'yummyani')).toBe(true)
  })
})
