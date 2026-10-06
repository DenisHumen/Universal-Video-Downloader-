import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REMOTE_PATH,
  endInterruptedRun,
  endInterruptedRuns,
  INTERRUPTED_NOTE,
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

  /*
    Sorting only what is saved from now on would leave the watches already on
    disk - one was stored as download, notify, upload - reading out of order
    for good. Repaired once on load, every screen that draws the list is right.
  */
  it('puts a chain saved in the order it was built into the order it runs', () => {
    const [w] = migrateWatches({
      watches: [
        watch({
          steps: [
            { id: 'd', kind: 'download', enabled: true },
            { id: 'n', kind: 'notify', enabled: true },
            {
              id: 'u',
              kind: 'upload',
              enabled: true,
              targetId: 't',
              remotePath: '{title}',
              createDirs: true,
              deleteLocalAfter: false
            }
          ]
        })
      ],
      runs: {}
    }).watches
    expect(w.steps.map((s) => s.id)).toEqual(['d', 'u', 'n'])
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

/*
  The count of failed goes at an episode is what stands between a transient
  failure and a lost episode. Dropped on load, every restart would hand a
  broken episode three fresh goes - and keeping junk in it could give up on
  an episode that never failed.
*/
describe('migrateWatches, for the failed goes at each episode', () => {
  it('keeps the count across a restart', () => {
    const [w] = migrateWatches({ watches: [watch({ attempts: { s1e4: 2 } })], runs: {} }).watches
    expect(w.attempts).toEqual({ s1e4: 2 })
  })

  it('drops what is not a count, and the map when nothing is left', () => {
    const junk = { s1e1: 0, s1e2: -1, s1e3: 1.5, s1e4: 'two', s1e5: 1 } as unknown as Record<string, number>
    const [w] = migrateWatches({ watches: [watch({ attempts: junk })], runs: {} }).watches
    expect(w.attempts).toEqual({ s1e5: 1 })

    const [none] = migrateWatches({
      watches: [watch({ attempts: ['s1e1'] as unknown as Record<string, number> })],
      runs: {}
    }).watches
    expect(none.attempts).toBeUndefined()
  })
})

/*
  A run the app was in the middle of when it closed stayed "running" in the
  history for good, next to the real run the next check started for the same
  episode, so nobody could tell whether anything was still happening.
*/
describe('endInterruptedRun', () => {
  const interrupted = (): Run =>
    run({
      state: 'running',
      startedAt: 1_000,
      steps: [
        { kind: 'download', state: 'done', startedAt: 1_000, finishedAt: 5_000 },
        { kind: 'upload', state: 'running', startedAt: 6_000 },
        { kind: 'notify', state: 'pending' }
      ]
    })

  it('ends it as failed, with the step it was on saying why', () => {
    const ended = endInterruptedRun(interrupted())
    expect(ended.state).toBe('failed')
    expect(ended.steps.map((s) => s.state)).toEqual(['done', 'failed', 'pending'])
    expect(ended.steps[1].message).toBe(INTERRUPTED_NOTE)
  })

  // Not the moment it was noticed, or a run cut short in a minute reads as lasting days.
  it('ends it when its last step was heard from', () => {
    expect(endInterruptedRun(interrupted()).finishedAt).toBe(6_000)
    expect(endInterruptedRun(run({ state: 'running', startedAt: 700, steps: [] })).finishedAt).toBe(700)
  })

  it('leaves a finished run exactly as it was', () => {
    const done = run({ state: 'done', finishedAt: 9 })
    expect(endInterruptedRun(done)).toBe(done)
  })

  it('says how many it ended, so the file is written back only when something changed', () => {
    const out = endInterruptedRuns({ w1: [run(), interrupted()], w2: [run({ id: 'r2', state: 'failed' })] })
    expect(out.ended).toBe(1)
    expect(out.runs.w1[1].state).toBe('failed')
    expect(endInterruptedRuns(out.runs).ended).toBe(0)
  })
})
