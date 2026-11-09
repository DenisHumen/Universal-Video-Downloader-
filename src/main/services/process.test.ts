import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import { groupSpawnOptions, killTree, ORPHAN_SCRIPT, reapOrphanedFfmpeg } from './process'

const realPlatform = process.platform

function asPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

afterEach(() => {
  asPlatform(realPlatform)
  vi.restoreAllMocks()
})

describe('groupSpawnOptions', () => {
  it('makes POSIX children process-group leaders', () => {
    // Without this, a negative-pid signal has no group to reach and ffmpeg
    // survives the cancel.
    asPlatform('linux')
    expect(groupSpawnOptions()).toEqual({ detached: true })
    asPlatform('darwin')
    expect(groupSpawnOptions()).toEqual({ detached: true })
  })

  it('leaves Windows alone, where taskkill /T walks the tree instead', () => {
    asPlatform('win32')
    expect(groupSpawnOptions()).toEqual({})
  })
})

describe('reapOrphanedFfmpeg', () => {
  it('has nothing to do outside Windows, or without an ffmpeg', async () => {
    asPlatform('linux')
    await expect(reapOrphanedFfmpeg('/opt/ffmpeg')).resolves.toBe(0)
    asPlatform('win32')
    await expect(reapOrphanedFfmpeg(undefined)).resolves.toBe(0)
  })

  it('takes the path from the environment, so no folder name can break the script', () => {
    expect(ORPHAN_SCRIPT).toContain('$env:UVD_FFMPEG')
    expect(ORPHAN_SCRIPT).not.toMatch(/[\\]/)
  })

  // A `uvd` beside the window has a running engine above its ffmpeg, and another install another path.
  it('only stops this copy of ffmpeg, and only with no parent left', () => {
    expect(ORPHAN_SCRIPT).toContain('$_.ExecutablePath -eq $env:UVD_FFMPEG -and -not $alive[[int]$_.ParentProcessId]')
  })
})

describe('killTree', () => {
  const child =(pid: number | undefined): ChildProcess =>
    ({ pid, kill: vi.fn() }) as unknown as ChildProcess

  it('does nothing without a process', () => {
    expect(() => killTree(null)).not.toThrow()
    expect(() => killTree(undefined)).not.toThrow()
  })

  it('does nothing for a child that never got a pid', () => {
    const c = child(undefined)
    killTree(c)
    expect(c.kill).not.toHaveBeenCalled()
  })

  it('signals the whole group on POSIX', () => {
    asPlatform('linux')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    killTree(child(4321))
    // Negative pid is what makes this reach ffmpeg as well as yt-dlp.
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM')
  })

  it('falls back to the single process when there is no group', () => {
    asPlatform('linux')
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const c = child(4321)
    killTree(c)
    expect(c.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('never throws when the process is already gone', () => {
    asPlatform('linux')
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const c = {
      pid: 1,
      kill: vi.fn(() => {
        throw new Error('already dead')
      })
    } as unknown as ChildProcess
    expect(() => killTree(c)).not.toThrow()
  })
})
