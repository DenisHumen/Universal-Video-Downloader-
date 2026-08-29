import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REMOTE_PATH,
  MAX_RUNS,
  migrateWatches,
  type PipelineStep,
  type Run,
  type Watch
} from './automation'

/*
  This runs against every user's file on the first launch after an update. A
  watch is something built by hand — a series, a dub, a naming template, a
  remote path — so the failure that matters is not a crash, it is quietly
  handing somebody an empty list.
*/

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: 'https://old.yummyani.me/catalog/item/tabakoshka',
  title: 'Табакошка',
  provider: 'yummyani',
  translatorId: 'tid',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 1000,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 500,
  ...over
})

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  watchId: 'w1',
  season: 1,
  episode: 1,
  title: 'Табакошка',
  state: 'done',
  steps: [],
  startedAt: 1,
  ...over
})

describe('migrateWatches', () => {
  it('keeps a watch that is already in good order', () => {
    const w = watch()
    expect(migrateWatches({ watches: [w], runs: {} }).watches[0]).toMatchObject({
      id: 'w1',
      title: 'Табакошка',
      quality: '720p'
    })
  })

  it('survives a file that is not there at all', () => {
    expect(migrateWatches(undefined)).toEqual({ watches: [], runs: {} })
    expect(migrateWatches(null)).toEqual({ watches: [], runs: {} })
    expect(migrateWatches({})).toEqual({ watches: [], runs: {} })
  })

  it('survives a file that is not the shape we expected', () => {
    expect(migrateWatches({ watches: 'nonsense' })).toEqual({ watches: [], runs: {} })
    expect(migrateWatches([1, 2, 3])).toEqual({ watches: [], runs: {} })
  })

  /*
    The point of the whole function: one bad entry must cost one entry, not the
    list.
  */
  it('drops only the entry it cannot repair', () => {
    const out = migrateWatches({
      watches: [watch({ id: 'good' }), { id: 'broken' }, null, watch({ id: 'alsogood' })],
      runs: {}
    })
    expect(out.watches.map((w) => w.id)).toEqual(['good', 'alsogood'])
  })

  it('fills in fields a file from an older build did not have', () => {
    const old = { ...watch(), failures: undefined, seen: undefined, quality: undefined }
    const [w] = migrateWatches({ watches: [old], runs: {} }).watches
    expect(w.failures).toBe(0)
    expect(w.seen).toEqual([])
    expect(w.quality).toBe('best')
  })

  it('refuses an interval short enough to hammer a site', () => {
    const [w] = migrateWatches({ watches: [watch({ intervalMinutes: 1 })], runs: {} }).watches
    expect(w.intervalMinutes).toBe(15)
  })

  it('falls back to a sensible interval when the file has nonsense in it', () => {
    for (const bad of [0, -5, NaN, 'soon' as unknown as number, undefined]) {
      const [w] = migrateWatches({ watches: [watch({ intervalMinutes: bad })], runs: {} }).watches
      expect(w.intervalMinutes, String(bad)).toBe(360)
    }
  })

  it('uses the URL as a name when the title is missing', () => {
    const [w] = migrateWatches({ watches: [watch({ title: '' })], runs: {} }).watches
    expect(w.title).toBe('https://old.yummyani.me/catalog/item/tabakoshka')
  })

  it('treats a watch as enabled unless it was explicitly turned off', () => {
    const on = migrateWatches({ watches: [{ ...watch(), enabled: undefined }], runs: {} })
    expect(on.watches[0].enabled).toBe(true)
    const off = migrateWatches({ watches: [watch({ enabled: false })], runs: {} })
    expect(off.watches[0].enabled).toBe(false)
  })

  it('throws away steps that are not steps', () => {
    const [w] = migrateWatches({
      watches: [watch({
        steps: [{ id: 'd', kind: 'download', enabled: true }, null, {}] as Watch['steps']
      })],
      runs: {}
    }).watches
    expect(w.steps).toHaveLength(1)
  })

  it('forgets runs whose watch is gone, since nothing could reach them', () => {
    const out = migrateWatches({
      watches: [watch({ id: 'w1' })],
      runs: { w1: [run()], deleted: [run({ watchId: 'deleted' })] }
    })
    expect(Object.keys(out.runs)).toEqual(['w1'])
  })

  it('caps the history so a series watched for years cannot grow forever', () => {
    const many = Array.from({ length: MAX_RUNS + 40 }, (_, i) => run({ id: `r${i}`, startedAt: i }))
    const out = migrateWatches({ watches: [watch()], runs: { w1: many } })
    expect(out.runs.w1).toHaveLength(MAX_RUNS)
    // The ones kept are the recent ones.
    expect(out.runs.w1[out.runs.w1.length - 1].id).toBe(`r${MAX_RUNS + 39}`)
  })
})

/*
  The first default filed every episode inside a `season 1` folder — a level of
  nesting nobody asked for, and one most series never need. Chains built with it
  are already saved, so changing the default alone would leave every existing
  watch still making the folder.
*/
describe('migrateWatches, for the season folder that nobody wanted', () => {
  const upload = (remotePath: string): PipelineStep => ({
    id: 'u',
    kind: 'upload',
    enabled: true,
    targetId: 't',
    remotePath,
    createDirs: true,
    deleteLocalAfter: false
  })

  const stepsOf = (step: PipelineStep): PipelineStep[] =>
    migrateWatches({ watches: [watch({ steps: [step] })] }).watches[0].steps

  it('moves a chain off the old default', () => {
    const [migrated] = stepsOf(upload('{title}/season {season}'))
    expect(migrated.kind === 'upload' && migrated.remotePath).toBe(DEFAULT_REMOTE_PATH)
  })

  it('files episodes straight into a folder named after the series', () => {
    expect(DEFAULT_REMOTE_PATH).toBe('{title}')
  })

  it('leaves a path somebody typed themselves exactly as written', () => {
    // Including one that still wants seasons — that is a choice, not the default.
    for (const chosen of ['anime/{title}', '{title}/season {season2}', 'seasons/{season}']) {
      const [migrated] = stepsOf(upload(chosen))
      expect(migrated.kind === 'upload' && migrated.remotePath).toBe(chosen)
    }
  })

  it('does not touch the other kinds of step', () => {
    const rename: PipelineStep = {
      id: 'r',
      kind: 'rename',
      enabled: true,
      template: '{title} - S{season2}E{episode2}',
      replacements: []
    }
    expect(stepsOf(rename)[0]).toEqual(rename)
  })
})
