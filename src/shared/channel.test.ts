import { describe, expect, it } from 'vitest'
import {
  episodeKey,
  migrateWatches,
  remoteDirFor,
  renameFor,
  renameGap,
  settleEpisode,
  videoRef,
  type RenameStep,
  type Watch
} from './automation'
import { asRef, firstFollow, keepsNewestLast, siftUploads, type ListedUpload } from './channel'

const NOW = Date.UTC(2026, 10, 9)
const DAY = 86_400_000

const up = (id: string, over: Partial<ListedUpload> = {}): ListedUpload => ({
  id,
  url: `https://example.com/watch/${id}`,
  title: `Video ${id}`,
  ...over
})

const seenOf = (...ids: string[]): Watch['seen'] => ids.map((id) => videoRef(id))

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w',
  url: 'https://example.com/@someone',
  title: 'Someone',
  provider: 'channel',
  translatorId: '',
  quality: 'best',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: seenOf('c', 'd', 'e'),
  steps: [],
  createdAt: NOW - 30 * DAY,
  lastCheckedAt: NOW - DAY,
  ...over
})

const ids = (refs: { videoId?: string }[]): (string | undefined)[] => refs.map((r) => r.videoId)

describe('which uploads of a listing are new', () => {
  it('finds what is above the newest known upload, and fetches it oldest first', () => {
    const out = siftUploads(watch(), [[up('a'), up('b'), up('c'), up('d'), up('e')]])
    expect(ids(out.fresh)).toEqual(['b', 'a'])
    expect(out.old).toEqual([])
    expect(out.changed).toBe(false)
  })

  it('keeps where to fetch a new upload from, and writes it down as owed at once', () => {
    const out = siftUploads(watch(), [[up('a'), up('c')]])
    expect(out.fresh[0]).toMatchObject({ videoUrl: 'https://example.com/watch/a', videoTitle: 'Video a' })
    expect(ids(out.owed)).toEqual(['a'])
  })

  it('a renamed channel changes nothing: uploads go by their id', () => {
    const out = siftUploads(watch({ title: 'Someone Else' }), [[up('c', { title: 'New name' }), up('d'), up('e')]])
    expect(out.fresh).toEqual([])
    expect(out.old).toEqual([])
  })

  it('takes an older video sliding into the window for what it is', () => {
    // Somebody deleted a video from the top, so number 31 is now on the list. Nobody has seen it; nobody uploaded it.
    const out = siftUploads(watch(), [[up('c'), up('d'), up('e'), up('older')]])
    expect(out.fresh).toEqual([])
    expect(ids(out.old)).toEqual(['older'])
    expect(out.old[0].videoUrl).toBeUndefined()
    expect(out.changed).toBe(false)
  })

  it('a list that has been reshuffled fetches nothing, and says so', () => {
    const out = siftUploads(watch(), [[up('p'), up('q'), up('c'), up('r'), up('s'), up('t'), up('d'), up('e')]])
    expect(out.fresh).toEqual([])
    expect(ids(out.old)).toEqual(expect.arrayContaining(['p', 'q', 'r', 's', 't']))
    expect(out.changed).toBe(true)
  })

  it('an old video made public again among the known ones does not read as a reshuffle', () => {
    const out = siftUploads(watch(), [[up('new'), up('c'), up('back'), up('d'), up('e')]])
    expect(ids(out.fresh)).toEqual(['new'])
    expect(ids(out.old)).toEqual(['back'])
    expect(out.changed).toBe(false)
  })

  it('a list with nothing known left is set aside rather than fetched whole', () => {
    const out = siftUploads(watch(), [[up('x'), up('y'), up('z')]])
    expect(out.fresh).toEqual([])
    expect(ids(out.old)).toEqual(['x', 'y', 'z'])
    expect(out.changed).toBe(true)
  })

  it('a date beats a place in the list, in both directions', () => {
    const out = siftUploads(watch(), [
      [
        up('stale', { at: NOW - 200 * DAY }),
        up('c'),
        up('recent', { at: NOW - 60_000 }),
        up('d'),
        up('e')
      ]
    ])
    expect(ids(out.fresh)).toEqual(['recent'])
    expect(ids(out.old)).toEqual(['stale'])
  })

  // The site was down for three days: each failed check moved "last checked", and what came out meanwhile was old.
  it('counts from the last look that saw the list, not the last that failed', () => {
    const down = watch({ lastListedAt: NOW - 4 * DAY, lastCheckedAt: NOW - 60_000 })
    const out = siftUploads(down, [[up('during', { at: NOW - 2 * DAY }), up('c'), up('d')]])
    expect(ids(out.fresh)).toEqual(['during'])
  })

  it('a dated list with nothing known keeps what is new and is not called changed', () => {
    const out = siftUploads(watch(), [[up('x', { at: NOW - 60_000 }), up('y', { at: NOW - 90 * DAY })]])
    expect(ids(out.fresh)).toEqual(['x'])
    expect(ids(out.old)).toEqual(['y'])
    expect(out.changed).toBe(false)
  })

  it('reads a list that keeps its newest last from the other end', () => {
    const out = siftUploads(watch({ newestLast: true }), [[up('older'), up('c'), up('d'), up('e'), up('a'), up('b')]])
    expect(ids(out.fresh)).toEqual(['a', 'b'])
    expect(ids(out.old)).toEqual(['older'])
  })

  it('judges each tab of a channel by its own newest', () => {
    const out = siftUploads(watch({ seen: seenOf('c', 'd', 's1', 's2') }), [
      [up('a'), up('c'), up('d')],
      [up('s0'), up('s1'), up('s2')]
    ])
    expect(ids(out.fresh)).toEqual(['a', 's0'])
  })

  it('a tab that has only just appeared is new, as long as another tab is known', () => {
    const out = siftUploads(watch(), [[up('c'), up('d')], [up('short')]])
    expect(ids(out.fresh)).toEqual(['short'])
    expect(out.changed).toBe(false)
  })

  it('counts a video on two tabs once', () => {
    const out = siftUploads(watch(), [
      [up('a'), up('c')],
      [up('a'), up('d')]
    ])
    expect(ids(out.fresh)).toEqual(['a'])
  })

  it('with nothing ever recorded, what is there is what was there', () => {
    const out = siftUploads(watch({ seen: [] }), [[up('x'), up('y')]])
    expect(out.fresh).toEqual([])
    expect(ids(out.old)).toEqual(['x', 'y'])
    expect(out.changed).toBe(false)
  })
})

describe('live and scheduled uploads', () => {
  it('are left alone until they end, and neither fetched nor counted as handled', () => {
    const out = siftUploads(watch(), [[up('now', { live: true }), up('c')]])
    expect(out.fresh).toEqual([])
    expect(out.old).toEqual([])
    expect(ids(out.owed)).toEqual(['now'])
  })

  it('are fetched once they end, wherever the list has moved them to', () => {
    const owed = [videoRef('now', 'https://example.com/watch/now', 'Stream')]
    const out = siftUploads(watch({ owed }), [[up('c'), up('now'), up('d')]])
    expect(ids(out.fresh)).toEqual(['now'])
  })

  it('stay put for as long as they are still on', () => {
    const owed = [videoRef('now', 'https://example.com/watch/now', 'Stream')]
    const out = siftUploads(watch({ owed }), [[up('now', { live: true }), up('c')]])
    expect(out.fresh).toEqual([])
    expect(ids(out.owed)).toEqual(['now'])
  })
})

describe('what is owed outlives the listing', () => {
  it('is fetched even when the list no longer shows it', () => {
    const owed = [videoRef('gone', 'https://example.com/watch/gone', 'Older pick')]
    expect(ids(siftUploads(watch({ owed }), [[up('c'), up('d')]]).fresh)).toEqual(['gone'])
    expect(ids(siftUploads(watch({ owed }), []).fresh)).toEqual(['gone'])
  })

  it('a failed upload below newer ones is tried again, not filed as old', () => {
    const owed = [videoRef('failed', 'https://example.com/watch/failed', 'Failed once')]
    const out = siftUploads(watch({ owed, seen: seenOf('newer', 'c') }), [[up('newer'), up('failed'), up('c')]])
    expect(ids(out.fresh)).toEqual(['failed'])
    expect(out.old).toEqual([])
  })

  it('leaves the list once it reaches seen, by id and without its address', () => {
    const ref = videoRef('a', 'https://example.com/watch/a', 'A')
    const patch = settleEpisode(watch({ owed: [ref] }), ref, 'done')
    expect(patch?.owed).toEqual([])
    expect(patch?.seen?.at(-1)).toEqual(videoRef('a'))
  })

  it('stays owed after a failure short of the cap', () => {
    const ref = videoRef('a', 'https://example.com/watch/a', 'A')
    const patch = settleEpisode(watch({ owed: [ref] }), ref, 'failed')
    expect(patch).toEqual({ attempts: { 'v:a': 1 } })
  })
})

describe('starting to follow', () => {
  const entries = ['n1', 'n2', 'n3', 'n4'].map((id) => asRef(up(id)))

  it('records everything and owes nothing by default', () => {
    const { seen, owed } = firstFollow(entries, [], 0, false)
    expect(ids(seen)).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(seen[0].videoUrl).toBeUndefined()
    expect(owed).toEqual([])
  })

  it('owes the latest N, oldest of them first', () => {
    const { seen, owed } = firstFollow(entries, [], 2, false)
    expect(ids(owed)).toEqual(['n2', 'n1'])
    expect(ids(seen)).toEqual(['n3', 'n4'])
  })

  it('takes them from the end of a list that keeps its newest last', () => {
    const { seen, owed } = firstFollow(entries, [], 1, true)
    expect(ids(owed)).toEqual(['n4'])
    expect(ids(seen)).toEqual(['n3', 'n2', 'n1'])
  })

  it('owes what is live now, picked or not', () => {
    expect(ids(firstFollow(entries, [asRef(up('live'))], 0, false).owed)).toEqual(['live'])
  })

  it('downloads nothing on the first check after following', () => {
    const { seen, owed } = firstFollow(entries, [], 0, false)
    const out = siftUploads(watch({ seen, owed, lastCheckedAt: undefined, createdAt: NOW }), [
      ['n1', 'n2', 'n3', 'n4'].map((id) => up(id))
    ])
    expect(out.fresh).toEqual([])
  })

  it('downloads just the pick on the first check, even if every upload was picked', () => {
    const { seen, owed } = firstFollow(entries, [], 4, false)
    const out = siftUploads(watch({ seen, owed, lastCheckedAt: undefined, createdAt: NOW }), [
      ['n1', 'n2', 'n3', 'n4'].map((id) => up(id))
    ])
    expect(ids(out.fresh)).toEqual(['n4', 'n3', 'n2', 'n1'])
  })
})

describe('which end of a list is new', () => {
  it('goes by the dates when both ends have one', () => {
    expect(keepsNewestLast('https://example.com/x', [up('a', { at: 1 }), up('b', { at: 2 })])).toBe(true)
    expect(keepsNewestLast('https://example.com/x', [up('a', { at: 2 }), up('b', { at: 1 })])).toBe(false)
  })

  it('takes a YouTube playlist to be in the order it was built, but not an uploads list', () => {
    expect(keepsNewestLast('https://www.youtube.com/playlist?list=PLabc', [up('a')])).toBe(true)
    expect(keepsNewestLast('https://www.youtube.com/playlist?list=UUabc', [up('a')])).toBe(false)
  })

  it('takes anything else to be newest first', () => {
    expect(keepsNewestLast('https://www.youtube.com/@someone/videos', [up('a'), up('b')])).toBe(false)
  })
})

describe('naming an upload', () => {
  const values = { title: 'Как устроен звук', channel: 'Some/One', videoId: 'abc', season: 0, episode: 0, ext: 'mp4' }
  const rename = (template: string): RenameStep => ({ id: 'r', kind: 'rename', enabled: true, template, replacements: [] })

  it('fills {title}, {channel} and {id}', () => {
    expect(renameFor(rename('{channel} - {title} [{id}]'), values)).toBe('Some One - Как устроен звук [abc].mp4')
  })

  it('a template written for a series falls back to the title, not to S00E00', () => {
    expect(renameFor(rename('{title} - S{season2}E{episode2}'), values)).toBe('Как устроен звук.mp4')
    expect(renameFor(rename(''), values)).toBe('Как устроен звук.mp4')
  })

  it('one that names nothing that differs gets the title on the end', () => {
    expect(renameFor(rename('{channel}'), values)).toBe('Some One - Как устроен звук.mp4')
  })

  it('says so in the editor', () => {
    expect(renameGap('{title} S{season}', true)).toBe('videoNumbers')
    expect(renameGap('{channel}', true)).toBe('videoName')
    expect(renameGap('{title}', true)).toBeUndefined()
    // And a series' template is judged as before.
    expect(renameGap('{title}')).toBe('episode')
  })

  it('a channel name with a slash cannot invent a folder on the share', () => {
    expect(remoteDirFor('{channel}', values)).toBe('Some One')
    expect(remoteDirFor('{channel}/season {season}', values)).toBe('Some One/season')
  })

  it('an episode goes on being named as it was', () => {
    const episode = { title: 'Show', season: 2, episode: 3, ext: 'mkv' }
    expect(renameFor(rename('{title} - S{season2}E{episode2}'), episode)).toBe('Show - S02E03.mkv')
    expect(renameFor(rename('{channel}'), episode)).toBe('Show - S02E03.mkv')
  })
})

describe('the keys and the file', () => {
  it('keeps the two kinds of key apart', () => {
    expect(episodeKey({ season: 1, episode: 2 })).toBe('s1e2')
    expect(episodeKey(videoRef('abc'))).toBe('v:abc')
  })

  it('a watches.json from before this loads exactly as it was', () => {
    const old = {
      watches: [
        {
          id: 'a',
          url: 'https://example.com/show',
          title: 'Show',
          provider: 'rezka',
          translatorId: '1',
          quality: '720p',
          enabled: true,
          intervalMinutes: 360,
          nextCheckAt: 5,
          failures: 0,
          seen: [{ season: 1, episode: 1 }],
          steps: [{ id: 'd', kind: 'download', enabled: true }],
          createdAt: 3
        }
      ],
      runs: {}
    }
    const { watches } = migrateWatches(JSON.parse(JSON.stringify(old)))
    expect(watches[0]).toMatchObject(old.watches[0])
    expect(watches[0].owed).toBeUndefined()
    expect(watches[0].seen).toEqual([{ season: 1, episode: 1 }])
  })

  it('a channel watch survives the same trip with its ids', () => {
    const w = watch({ seen: seenOf('a'), owed: [videoRef('b', 'https://example.com/b', 'B')], newestLast: true, listCount: 40 })
    const { watches } = migrateWatches({ watches: [w], runs: {} })
    expect(watches[0]).toMatchObject({ seen: seenOf('a'), owed: w.owed, newestLast: true, listCount: 40 })
  })
})
