import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpisodeRef, Run, Watch } from '@shared/automation'
import type { CheckResult } from './detect'

/*
  The watcher with everything around it replaced: the site check, the episode
  chain, the store and Electron. What is left is the scheduling itself - which
  watch is looked at when, how many at once, and what "check now" answers -
  which is where a stalled download used to stop every series being checked.
*/

const h = vi.hoisted(() => ({
  watches: new Map<string, Watch>(),
  online: true,
  checkWatch: vi.fn(),
  runEpisode: vi.fn(),
  recordOutcome: vi.fn(),
  runs: new Map<string, Run>()
}))

vi.mock('electron', () => ({
  net: { isOnline: () => h.online },
  powerMonitor: { on: vi.fn(), off: vi.fn() }
}))
vi.mock('../log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./detect', () => ({ checkWatch: h.checkWatch }))
vi.mock('./pipeline', () => ({
  alertChannel: () => undefined,
  recordOutcome: h.recordOutcome,
  runEpisode: h.runEpisode
}))
vi.mock('./telegram', () => ({ composeCheckFailure: () => '', sendNotification: vi.fn() }))
vi.mock('./store', () => ({
  findRun: (id: string) => h.runs.get(id),
  getWatch: (id: string) => h.watches.get(id),
  listWatches: () => [...h.watches.values()],
  updateWatch: (id: string, patch: Partial<Watch>) => {
    const current = h.watches.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch }
    h.watches.set(id, next)
    return next
  }
}))

type WatcherModule = typeof import('./watcher')

const NOW = 1_800_000_000_000
const MIN = 60_000
const ep = (episode: number): EpisodeRef => ({ season: 1, episode })

function watch(id: string, extra: Partial<Watch> = {}): Watch {
  const w: Watch = {
    id,
    url: `https://example.com/${id}`,
    title: id,
    provider: 'yummyani',
    translatorId: 't',
    quality: '720p',
    enabled: true,
    intervalMinutes: 360,
    nextCheckAt: NOW - MIN,
    failures: 0,
    seen: [],
    steps: [{ id: 'd', kind: 'download', enabled: true }],
    createdAt: 1,
    ...extra
  }
  h.watches.set(id, w)
  return w
}

const found = (fresh: EpisodeRef[], extra: Partial<CheckResult> = {}): CheckResult => ({
  fresh,
  available: fresh,
  title: 'A series',
  ...extra
})

/** A promise that settles only when the test says so - a download that takes its time. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => undefined
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** Ids passed to the site check, in order. */
const checkedIds = (): string[] => h.checkWatch.mock.calls.map(([w]) => (w as Watch).id)

/*
  Let promises and immediates run their course. A millisecond at a time,
  because the fake clock files an immediate queued while it is firing timers
  one millisecond on - a long way short of the minute the next tick is away.
*/
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1)
}

describe('watcher', () => {
  let watcher: WatcherModule

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    h.watches.clear()
    h.online = true
    h.checkWatch.mockReset()
    h.runEpisode.mockReset()
    h.recordOutcome.mockReset()
    h.runs.clear()
    // A fresh module each time: the slots and the in-flight set are module state.
    vi.resetModules()
    watcher = await import('./watcher')
  })

  afterEach(() => {
    watcher.stopWatcher()
    vi.useRealTimers()
  })

  /*
    Two watches downloading a backlog held both check slots for the whole
    download, so a third series was not looked at until they had finished -
    hours on a slow line, for ever if a download was paused.
  */
  it('checks every due watch while earlier ones are still downloading', async () => {
    watch('a', { nextCheckAt: NOW - 3 * MIN })
    watch('b', { nextCheckAt: NOW - 2 * MIN })
    watch('c', { nextCheckAt: NOW - MIN })
    h.checkWatch.mockResolvedValue(found([ep(1)]))
    const download = deferred()
    h.runEpisode.mockReturnValue(download.promise)

    watcher.startWatcher()
    await vi.advanceTimersByTimeAsync(30_000)

    // The third starts as soon as a slot is free, not a minute later at the next tick.
    await settle()
    expect(checkedIds()).toEqual(['a', 'b', 'c'])
    expect(h.runEpisode).toHaveBeenCalledTimes(3)
    expect(watcher.watcherBusy()).toBe(true)

    download.resolve()
    await settle()
    expect(h.recordOutcome).toHaveBeenCalledTimes(3)
    expect(watcher.watcherBusy()).toBe(false)
  })

  it('still looks at no more than two pages at once', async () => {
    for (const id of ['a', 'b', 'c']) watch(id)
    h.checkWatch.mockReturnValue(new Promise(() => undefined))

    watcher.tick()
    watcher.tick()
    await settle()
    expect(h.checkWatch).toHaveBeenCalledTimes(2)
  })

  /*
    The slot is given back when the site answers and again when the whole
    check ends. Without the guard a failed check gave it back twice, and from
    then on three pages were read at once.
  */
  it('gives the slot back exactly once when a check fails', async () => {
    watch('bad', { nextCheckAt: NOW - 4 * MIN })
    watch('b', { nextCheckAt: NOW - 3 * MIN })
    watch('c', { nextCheckAt: NOW - 2 * MIN })
    watch('d', { nextCheckAt: NOW - MIN })
    h.checkWatch.mockImplementation((w: Watch) =>
      w.id === 'bad' ? Promise.reject(new Error('HTTP 500')) : new Promise(() => undefined)
    )

    watcher.tick()
    await settle()
    watcher.tick()
    watcher.tick()
    await settle()

    expect(checkedIds()).toEqual(['bad', 'b', 'c'])
    expect(h.watches.get('bad')).toMatchObject({ failures: 1, lastError: 'HTTP 500' })
  })

  /*
    "Check now" waited for every episode to download and upload, and on a
    watch that was already busy it returned at once having checked nothing,
    while the screen said "checked".
  */
  it('answers "check now" once the page is read, and says busy while episodes are still going', async () => {
    watch('a')
    h.checkWatch.mockResolvedValue(found([ep(1), ep(2)]))
    const download = deferred()
    h.runEpisode.mockReturnValue(download.promise)

    await expect(watcher.checkNow('a')).resolves.toEqual({ fresh: 2, queued: 2, paused: false })
    expect(h.runEpisode).toHaveBeenCalledTimes(1)

    await expect(watcher.checkNow('a')).resolves.toEqual({ busy: true })
    expect(h.checkWatch).toHaveBeenCalledTimes(1)

    download.resolve()
    await settle()
    expect(h.recordOutcome).toHaveBeenCalledTimes(2)
    expect(watcher.watcherBusy()).toBe(false)
  })

  it('reports what a paused watch found without fetching any of it', async () => {
    watch('a', { enabled: false })
    h.checkWatch.mockResolvedValue(found([ep(1), ep(2), ep(3)]))

    await expect(watcher.checkNow('a')).resolves.toEqual({ fresh: 3, queued: 0, paused: true })
    expect(h.runEpisode).not.toHaveBeenCalled()
  })

  it('reports a title that is not out yet, with the date the site gives', async () => {
    watch('a', { pending: true })
    h.checkWatch.mockResolvedValue(found([], { notOut: { releaseAt: NOW + 3 * 86_400_000 } }))

    await expect(watcher.checkNow('a')).resolves.toEqual({
      notOut: true,
      releaseAt: NOW + 3 * 86_400_000
    })
  })

  it('does not count a failed "check now" against the watch', async () => {
    watch('a', { failures: 1, nextCheckAt: NOW + 60 * MIN })
    h.checkWatch.mockRejectedValue(new Error('HTTP 503'))

    await expect(watcher.checkNow('a')).resolves.toEqual({ error: 'HTTP 503' })
    expect(h.watches.get('a')).toMatchObject({
      failures: 1,
      nextCheckAt: NOW + 60 * MIN,
      lastError: 'HTTP 503'
    })
  })

  /*
    A wake that checked before Wi-Fi was back counted the failure and doubled
    every overdue watch's wait.
  */
  it('does not count a failure that happened offline, and tries again in fifteen minutes', async () => {
    watch('a', { failures: 1 })
    h.checkWatch.mockRejectedValue(
      new Error('Could not reach example.com: the network is unreachable. (ERR_INTERNET_DISCONNECTED)')
    )

    watcher.tick()
    await settle()

    const after = h.watches.get('a') as Watch
    expect(after.failures).toBe(1)
    expect(after.lastError).toBeUndefined()
    expect(after.nextCheckAt).toBeGreaterThanOrEqual(NOW + 15 * MIN)
    expect(after.nextCheckAt).toBeLessThan(NOW + 17 * MIN)
  })

  /*
    "Try again" and the schedule must not fetch the same episode side by side:
    the button is refused while the watch is in flight, and holds the watch in
    flight itself, so a tick in the meantime leaves it alone.
  */
  it('refuses "try again" while the watch is busy, and keeps the schedule off it while retrying', async () => {
    watch('a')
    h.runs.set('r1', {
      id: 'r1',
      watchId: 'a',
      season: 1,
      episode: 4,
      title: 'a',
      state: 'failed',
      steps: [],
      startedAt: 1
    })
    h.checkWatch.mockResolvedValue(found([ep(1)]))
    const download = deferred<string>()
    const retrying = deferred<string>()
    h.runEpisode.mockReturnValueOnce(download.promise).mockReturnValueOnce(retrying.promise)

    await watcher.checkNow('a')
    expect(watcher.retryRun('r1')).toEqual({ busy: true })
    download.resolve('done')
    await settle()

    expect(watcher.retryRun('r1')).toEqual({ started: true })
    expect(h.runEpisode).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'a' }),
      { season: 1, episode: 4 },
      // The title the site gave at the last check, which the check wrote to the watch.
      'A series',
      expect.objectContaining({ final: false, attempt: 1, previous: expect.objectContaining({ id: 'r1' }) })
    )

    // Due again while the retry is still downloading: the tick leaves it alone.
    h.watches.set('a', { ...(h.watches.get('a') as Watch), nextCheckAt: NOW - MIN })
    watcher.tick()
    await settle()
    expect(h.checkWatch).toHaveBeenCalledTimes(1)
    expect(watcher.retryRun('r1')).toEqual({ busy: true })

    retrying.resolve('failed')
    await settle()
    expect(h.recordOutcome).toHaveBeenLastCalledWith('a', { season: 1, episode: 4 }, 'failed')
    expect(watcher.watcherBusy()).toBe(false)
  })

  it('will not try again an episode that is running or done', () => {
    watch('a')
    h.runs.set('r2', {
      id: 'r2',
      watchId: 'a',
      season: 1,
      episode: 1,
      title: 'a',
      state: 'done',
      steps: [],
      startedAt: 1
    })
    expect(watcher.retryRun('r2')).toMatchObject({ error: expect.any(String) })
    expect(watcher.retryRun('missing')).toMatchObject({ error: expect.any(String) })
    expect(h.runEpisode).not.toHaveBeenCalled()
  })

  it('starts nothing while the machine says it is offline', async () => {
    watch('a')
    h.online = false
    watcher.tick()
    await settle()
    expect(h.checkWatch).not.toHaveBeenCalled()
  })
})
