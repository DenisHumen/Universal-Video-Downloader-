import { describe, expect, it } from 'vitest'
import type { Run, RunStep } from '@shared/automation'
import { carryOver } from './carry-over'

/*
  A retry that misses the file it already has downloads the whole episode
  again and leaves a second copy beside the first - at every check, for every
  upload a sleeping NAS refused. One that picks up a file that is gone fails
  for nothing.
*/

const step = (kind: RunStep['kind'], state: RunStep['state']): RunStep => ({ kind, state })

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  watchId: 'w1',
  season: 1,
  episode: 4,
  title: 'Series',
  state: 'failed',
  steps: [step('download', 'done'), step('upload', 'failed'), step('notify', 'pending')],
  filepath: 'C:/dl/Series - S01E04.mp4',
  startedAt: 1,
  ...over
})

const onDisk = (...paths: string[]) => (path: string): boolean => paths.includes(path)

describe('carryOver', () => {
  it('keeps the downloaded file when a later step failed', () => {
    expect(carryOver(run(), onDisk('C:/dl/Series - S01E04.mp4'))).toEqual({
      filepath: 'C:/dl/Series - S01E04.mp4'
    })
  })

  it('downloads again when the file has gone since', () => {
    expect(carryOver(run(), onDisk())).toEqual({})
  })

  it('downloads again when the download itself is what failed', () => {
    const failed = run({ steps: [step('download', 'failed')], filepath: undefined })
    expect(carryOver(failed, onDisk('C:/dl/Series - S01E04.mp4'))).toEqual({})
  })

  // Telegram down after the upload: only the message is left, even with the local copy removed.
  it('does not upload again what already went through', () => {
    const notifyFailed = run({
      steps: [step('download', 'done'), step('upload', 'done'), step('notify', 'failed')],
      remotePath: 'series/Series - S01E04.mp4'
    })
    expect(carryOver(notifyFailed, onDisk())).toEqual({
      filepath: undefined,
      remotePath: 'series/Series - S01E04.mp4'
    })
  })

  it('takes nothing from a run that finished, or one still going', () => {
    const exists = onDisk('C:/dl/Series - S01E04.mp4')
    expect(carryOver(run({ state: 'done' }), exists)).toEqual({})
    expect(carryOver(run({ state: 'running' }), exists)).toEqual({})
    expect(carryOver(undefined, exists)).toEqual({})
  })
})
