import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Watch } from '@shared/automation'
import type { StreamingInfo } from '@shared/types'
import { checkWatch, episodesForTranslator } from './detect'

/*
  A watch whose dub disappeared from the page used to read the default dub's
  episode list instead. Every episode it had not seen was queued under the
  dead dub, failed, and was marked seen, while the watch itself looked healthy -
  so when the dub came back on a new player, those episodes never came with it.
*/

const h = vi.hoisted(() => ({ resolveUrl: vi.fn() }))

vi.mock('../../resolvers', () => ({ resolveUrl: h.resolveUrl }))
vi.mock('../log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const eps = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1)

/** A page with dub A (eight episodes, the default) and dub B (three). */
function page(extra: Partial<StreamingInfo> = {}): StreamingInfo {
  return {
    provider: 'yummyani',
    host: 'example.com',
    id: '1',
    title: 'Series',
    isSeries: true,
    translators: [
      { id: 'A', name: 'Dub A' },
      { id: 'B', name: 'Dub B' }
    ],
    defaultTranslator: 'A',
    seasons: [{ season: 1, episodes: eps(8) }],
    episodesByTranslator: {
      A: [{ season: 1, episodes: eps(8) }],
      B: [{ season: 1, episodes: eps(3) }]
    },
    qualities: ['720p'],
    ...extra
  }
}

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: 'https://example.com/series',
  title: 'Series',
  provider: 'yummyani',
  translatorId: 'GONE',
  translatorName: 'Dub Gone',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 }
  ],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1,
  ...over
})

describe('episodesForTranslator', () => {
  it("gives a dub the page no longer lists no episodes, not the default dub's", () => {
    expect(episodesForTranslator(page(), 'GONE')).toEqual([])
  })

  it('reads the series list for a provider that does not list episodes per dub', () => {
    const plain = page({ episodesByTranslator: undefined })
    expect(episodesForTranslator(plain, 'A')).toHaveLength(8)
  })
})

describe('checkWatch, when the followed dub is not on the page', () => {
  beforeEach(() => h.resolveUrl.mockReset())

  it("fails the check loudly instead of finding the default dub's episodes", async () => {
    h.resolveUrl.mockResolvedValue({ streaming: page() })
    await expect(checkWatch(watch())).rejects.toThrow('no longer listed')
  })

  // Several dubs by that name - one dub can run on several players - is no answer either.
  it('fails just the same when the name matches more than one dub', async () => {
    const twice = page({
      translators: [
        { id: 'A', name: 'Dub Gone' },
        { id: 'B', name: 'Dub Gone' }
      ]
    })
    h.resolveUrl.mockResolvedValue({ streaming: twice })
    await expect(checkWatch(watch())).rejects.toThrow('no longer listed')
  })

  /*
    A yummyani dub's id is its player's address, so the same dub moved to a new
    player arrives under a new id and the old name.
  */
  it('follows a dub that moved to a new id under the same name', async () => {
    const moved = page({
      translators: [
        { id: 'A', name: 'Dub A' },
        { id: 'NEW', name: 'Dub Gone' }
      ],
      episodesByTranslator: {
        A: [{ season: 1, episodes: eps(8) }],
        NEW: [{ season: 1, episodes: eps(4) }]
      }
    })
    h.resolveUrl.mockResolvedValue({ streaming: moved })

    const result = await checkWatch(watch())
    expect(result.adopt).toEqual({ translatorId: 'NEW', translatorName: 'Dub Gone' })
    // Worked out against the dub it now follows, in the same check.
    expect(result.fresh).toEqual([
      { season: 1, episode: 3 },
      { season: 1, episode: 4 }
    ])
    expect(result.translatorName).toBe('Dub Gone')
  })

  it('adopts nothing while the followed dub is still there', async () => {
    h.resolveUrl.mockResolvedValue({ streaming: page() })
    const result = await checkWatch(watch({ translatorId: 'B', translatorName: 'Dub B' }))
    expect(result.adopt).toBeUndefined()
    expect(result.fresh).toEqual([{ season: 1, episode: 3 }])
  })
})
