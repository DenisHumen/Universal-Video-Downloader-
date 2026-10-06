import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newEpisodes, type EpisodeRef, type Run, type Watch } from '@shared/automation'
import type { DownloadItem, DownloadRequest } from '@shared/types'

/*
  The watcher, the pipeline and the store as they are, with a pretend queue,
  site, share and Telegram around them. This is where one failed download used
  to lose an episode for good: every go marked its episode handled, failed or
  not, so nothing ever tried it again.
*/

type Plan = 'ok' | 'fail' | 'cancel' | 'hang'

const h = vi.hoisted(() => {
  class TelegramError extends Error {
    constructor(
      message: string,
      readonly kind: string
    ) {
      super(message)
    }
  }
  return {
    dir: '',
    plan: [] as Plan[],
    started: [] as string[],
    items: new Map<string, unknown>(),
    events: null as unknown as import('events').EventEmitter,
    upload: vi.fn(),
    send: vi.fn(),
    failures: [] as unknown[][],
    TelegramError,
    /** Power-save blockers started and not yet stopped. */
    blockers: new Set<number>()
  }
})

vi.mock('electron', () => {
  let next = 0
  return {
    app: { getPath: () => h.dir },
    net: { isOnline: () => true },
    powerMonitor: { on: vi.fn(), off: vi.fn() },
    powerSaveBlocker: {
      start: () => {
        h.blockers.add(++next)
        return next
      },
      stop: (id: number) => h.blockers.delete(id),
      isStarted: (id: number) => h.blockers.has(id)
    }
  }
})
vi.mock('../log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../settings', () => ({
  getSettings: () => ({
    telegramChatId: '100000000',
    smbTargets: [
      { id: 'nas', name: 'NAS', host: '192.168.1.10', share: 'media', path: '', domain: '', username: 'u' }
    ]
  })
}))
vi.mock('../secrets', () => ({
  getSecret: () => 'example-secret',
  SECRET: { smbPassword: (id: string) => `smb:${id}`, telegramToken: () => 'telegram' }
}))
vi.mock('./smb', () => ({ uploadFile: h.upload }))
vi.mock('./telegram', () => ({
  composeEpisodeNews: () => 'news',
  composeCheckFailure: () => 'check failed',
  composeFailure: (...args: unknown[]) => {
    h.failures.push(args)
    return 'episode failed'
  },
  sendNotification: h.send,
  TelegramError: h.TelegramError
}))

/** The site: every episode of dub "t" up to the fourth, minus what the watch has seen. */
vi.mock('./detect', () => ({
  checkWatch: async (w: Watch) => {
    const available: EpisodeRef[] = [1, 2, 3, 4].map((episode) => ({ season: 1, episode }))
    return { fresh: newEpisodes(w.seen, available), available, title: w.title }
  },
  downloadUrlFor: (w: Watch, ref: EpisodeRef) => `uvd-yummy://${w.translatorId}/${ref.episode}/720p`
}))

/** The queue: each download does what the next entry in `plan` says, a moment after it is queued. */
vi.mock('../downloader', async () => {
  const { EventEmitter: Emitter } = await import('events')
  const { writeFileSync: write } = await import('fs')
  const { join: joinPath } = await import('path')
  h.events = new Emitter()
  const update = (item: DownloadItem): void => {
    h.events.emit('updated', { ...item })
  }
  return {
    downloadEvents: h.events,
    getDownload: (id: string) => h.items.get(id),
    relocateItem: (id: string, patch: Partial<DownloadItem>) => {
      const item = h.items.get(id)
      if (item) Object.assign(item, patch)
    },
    resumeDownload: vi.fn(),
    cancelDownload: (id: string) => {
      const item = h.items.get(id) as DownloadItem
      item.state = 'canceled'
      update(item)
    },
    startDownload: async (req: DownloadRequest): Promise<DownloadItem> => {
      const id = `d${h.started.length + 1}`
      h.started.push(req.url)
      const item: DownloadItem = {
        id,
        url: req.url,
        title: req.title || req.url,
        mode: req.mode,
        state: 'queued',
        percent: 0,
        outputDir: h.dir,
        createdAt: 0
      }
      h.items.set(id, item)
      const plan = h.plan.shift() ?? 'ok'
      setTimeout(() => {
        if (plan === 'ok') {
          item.filepath = joinPath(h.dir, `${id}.mp4`)
          write(item.filepath, 'video')
          item.state = 'completed'
        } else if (plan === 'fail') {
          item.state = 'error'
          item.error = 'HTTP 502 from the player'
        } else if (plan === 'cancel') {
          item.state = 'canceled'
        } else {
          item.state = 'downloading'
        }
        update(item)
      }, 1)
      return { ...item }
    }
  }
})

type Modules = {
  watcher: typeof import('./watcher')
  store: typeof import('./store')
  pipeline: typeof import('./pipeline')
}

const watch = (): Watch => ({
  id: 'w1',
  url: 'https://example.com/series',
  title: 'Series',
  provider: 'yummyani',
  translatorId: 't',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  // Only the fourth episode is new.
  seen: [1, 2, 3].map((episode) => ({ season: 1, episode })),
  steps: [
    { id: 'd', kind: 'download', enabled: true },
    {
      id: 'u',
      kind: 'upload',
      enabled: true,
      targetId: 'nas',
      remotePath: '{title}',
      createDirs: true,
      deleteLocalAfter: false
    },
    { id: 'n', kind: 'notify', enabled: true }
  ],
  createdAt: 1
})

const e4 = { season: 1, episode: 4 }
const seen4 = (w: Watch | undefined): boolean => Boolean(w?.seen.some((s) => s.episode === 4))

describe('an episode that fails', () => {
  let m: Modules

  /** One check, and everything it found taken through the chain. */
  async function check(): Promise<void> {
    await m.watcher.checkNow('w1')
    await vi.waitFor(() => expect(m.watcher.watcherBusy()).toBe(false))
  }

  const runs = (): Run[] => m.store.listRuns('w1')

  beforeEach(async () => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-retries-'))
    h.plan = []
    h.started = []
    h.items.clear()
    h.failures = []
    h.blockers.clear()
    h.upload.mockReset()
    h.upload.mockResolvedValue({ remotePath: 'Series/d1.mp4', seconds: 2 })
    h.send.mockReset()
    h.send.mockResolvedValue(undefined)
    // A fresh store, watcher and pipeline each time: all three keep module state.
    vi.resetModules()
    m = {
      watcher: await import('./watcher'),
      store: await import('./store'),
      pipeline: await import('./pipeline')
    }
    m.store.addWatch(watch())
  })

  afterEach(() => {
    m.store.flushWatches()
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('is tried again at the next check, and given up on - with one message - after the third', async () => {
    h.plan = ['fail', 'fail', 'fail']

    await check()
    expect(seen4(m.store.getWatch('w1'))).toBe(false)
    expect(m.store.getWatch('w1')?.attempts).toEqual({ s1e4: 1 })
    expect(m.store.getWatch('w1')?.lastRunError).toBe('HTTP 502 from the player')
    expect(h.send).not.toHaveBeenCalled()

    await check()
    expect(h.started).toHaveLength(2)
    expect(m.store.getWatch('w1')?.attempts).toEqual({ s1e4: 2 })
    expect(h.send).not.toHaveBeenCalled()

    await check()
    expect(h.started).toHaveLength(3)
    expect(seen4(m.store.getWatch('w1'))).toBe(true)
    expect(m.store.getWatch('w1')?.attempts).toBeUndefined()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.failures[0]).toEqual(['Series', 1, 4, 'HTTP 502 from the player', 3])

    // Given up on: the next check leaves it alone.
    await check()
    expect(h.started).toHaveLength(3)
    // One row for the episode, saying how it stands, rather than three.
    expect(runs().map((r) => r.state)).toEqual(['failed'])
  })

  it('is fetched by "try again" after it was given up on, in place of the failed run', async () => {
    h.plan = ['fail', 'fail', 'fail', 'ok']
    await check()
    await check()
    await check()
    const [failed] = runs()

    expect(m.watcher.retryRun(failed.id)).toEqual({ started: true })
    await vi.waitFor(() => expect(m.watcher.watcherBusy()).toBe(false))

    expect(runs().map((r) => r.state)).toEqual(['done'])
    expect(m.store.getWatch('w1')?.seen.filter((s) => s.episode === 4)).toHaveLength(1)
    expect(m.store.getWatch('w1')?.lastRunError).toBeUndefined()
  })

  /*
    "Try again" on a paused series put the episode on the queue, found the
    watch paused, cancelled it on the spot and replaced the failed run with a
    skipped one - a dead row in Downloads, under a toast saying it was trying.
  */
  it('is not tried by hand while the watch is paused', async () => {
    h.plan = ['fail']
    await check()
    const [failed] = runs()
    m.store.updateWatch('w1', { enabled: false })

    expect(m.watcher.retryRun(failed.id)).toEqual({ paused: true })
    expect(m.watcher.watcherBusy()).toBe(false)
    expect(h.started).toHaveLength(1)
    expect(runs()).toEqual([failed])
    expect(m.store.getWatch('w1')?.attempts).toEqual({ s1e4: 1 })
  })

  /*
    A NAS asleep at four in the morning. The retry used to download the whole
    episode again and leave a second copy beside the first.
  */
  it('picks up a refused upload with the file it already downloaded', async () => {
    h.upload.mockRejectedValueOnce(new Error('Could not reach 192.168.1.10'))

    await check()
    const [first] = runs()
    expect(first.state).toBe('failed')
    expect(first.steps.map((s) => s.state)).toEqual(['done', 'failed', 'pending'])
    expect(first.filepath && existsSync(first.filepath)).toBe(true)

    await check()
    expect(h.started).toHaveLength(1)
    expect(h.upload).toHaveBeenCalledTimes(2)
    expect(h.upload.mock.calls[1][2]).toBe(first.filepath)
    const [second] = runs()
    expect(runs()).toHaveLength(1)
    expect(second.state).toBe('done')
    expect(seen4(m.store.getWatch('w1'))).toBe(true)
  })

  /*
    The episode is on the share. A message that did not follow it used to fail
    the whole run, and the failure notice then went out through the same bot -
    a second message into a chat that was already refusing them.
  */
  it('is done, and handled, when only the message failed', async () => {
    h.send.mockRejectedValueOnce(new h.TelegramError('Telegram is rate-limiting this bot', 'rate'))

    await check()
    const [run] = runs()
    expect(run.state).toBe('done')
    expect(run.remotePath).toBe('Series/d1.mp4')
    expect(run.steps.map((s) => s.state)).toEqual(['done', 'done', 'failed'])
    expect(run.steps[2].message).toBe('Telegram is rate-limiting this bot')
    expect(seen4(m.store.getWatch('w1'))).toBe(true)
    expect(m.store.getWatch('w1')?.lastRunError).toBeUndefined()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.failures).toEqual([])

    await check()
    expect(h.started).toHaveLength(1)
    expect(h.upload).toHaveBeenCalledTimes(1)
  })

  // A blocked bot fails every episode's message, and the watch is where somebody looks.
  it('puts a bot that cannot write to the chat on the watch', async () => {
    h.send.mockRejectedValueOnce(new h.TelegramError('The bot has been blocked by that chat.', 'chat'))

    await check()
    expect(runs()[0].state).toBe('done')
    expect(m.store.getWatch('w1')?.lastRunError).toBe('The bot has been blocked by that chat.')
  })

  /*
    The queue lets go of the machine as soon as the download completes, and the
    upload after it ran with nothing to stop the machine sleeping halfway.
  */
  it('keeps the machine awake through the upload and the message, and lets go after', async () => {
    const held: number[] = []
    h.upload.mockImplementation(async () => {
      held.push(h.blockers.size)
      return { remotePath: 'Series/d1.mp4', seconds: 2 }
    })
    h.send.mockImplementation(async () => {
      held.push(h.blockers.size)
    })

    await check()
    expect(held).toEqual([1, 1])
    expect(h.blockers.size).toBe(0)
  })

  it('lets the machine sleep again when the upload fails', async () => {
    h.upload.mockRejectedValueOnce(new Error('Could not reach 192.168.1.10'))
    await check()
    expect(runs()[0].state).toBe('failed')
    expect(h.blockers.size).toBe(0)
  })

  // The row in Downloads kept the name the file was downloaded under, so Play did nothing.
  it('points the queue row at the renamed file', async () => {
    m.store.updateWatch('w1', {
      steps: [
        watch().steps[0],
        { id: 'r', kind: 'rename', enabled: true, template: '{title} {episode2}', replacements: [] },
        ...watch().steps.slice(1)
      ]
    })

    await check()
    const item = h.items.get('d1') as DownloadItem
    expect(item.filepath).toBe(join(h.dir, 'Series 04.mp4'))
    expect(existsSync(item.filepath as string)).toBe(true)
    expect(item.remotePath).toBe('Series/d1.mp4')
  })

  it('points the queue row at the share once the local copy is deleted', async () => {
    const [download, upload, notify] = watch().steps
    m.store.updateWatch('w1', {
      steps: [download, { ...upload, deleteLocalAfter: true } as typeof upload, notify]
    })

    await check()
    const item = h.items.get('d1') as DownloadItem
    expect(item.filepath).toBeUndefined()
    expect(item.remotePath).toBe('Series/d1.mp4')
  })

  // Somebody cancelled it in the queue on purpose; fetching it again behind their back would undo that.
  it('is skipped, and handled, when its download is cancelled in the queue', async () => {
    h.plan = ['cancel']
    await check()

    const [run] = runs()
    expect(run.state).toBe('skipped')
    expect(run.steps[0]).toMatchObject({ state: 'skipped', message: 'The download was cancelled.' })
    expect(seen4(m.store.getWatch('w1'))).toBe(true)
    expect(m.store.getWatch('w1')?.lastRunError).toBeUndefined()
    expect(h.send).not.toHaveBeenCalled()
  })

  /*
    Pausing a watch left its current download running on to the upload and the
    message. Now it stops, quietly, and the episode is fetched once the watch
    is resumed - not marked handled, not counted as a failure.
  */
  it('stops quietly when the watch is paused mid-download, and is fetched after resuming', async () => {
    h.plan = ['hang', 'ok']
    await m.watcher.checkNow('w1')
    await vi.waitFor(() => expect(h.items.get('d1')).toMatchObject({ state: 'downloading' }))

    m.store.updateWatch('w1', { enabled: false })
    m.pipeline.stopEpisode('w1', 'paused')
    await vi.waitFor(() => expect(m.watcher.watcherBusy()).toBe(false))

    const w = m.store.getWatch('w1')
    expect(seen4(w)).toBe(false)
    expect(w?.attempts).toBeUndefined()
    expect(w?.lastRunError).toBeUndefined()
    expect(runs()[0]).toMatchObject({ state: 'skipped' })
    expect(h.upload).not.toHaveBeenCalled()

    m.store.updateWatch('w1', { enabled: true })
    await check()
    expect(h.started).toHaveLength(2)
    expect(runs().map((r) => r.state)).toEqual(['done'])
  })
})
