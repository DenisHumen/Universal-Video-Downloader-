import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ started: new Set<number>(), starts: 0 }))

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: () => {
      h.started.add(++h.starts)
      return h.starts
    },
    stop: (id: number) => h.started.delete(id),
    isStarted: (id: number) => h.started.has(id)
  }
}))

type Awake = typeof import('./awake')

/*
  One switch used to serve the queue alone, so the queue going idle the moment
  an episode finished downloading let the machine sleep through that episode's
  upload. Every holder now counts until it lets go itself.
*/
describe('keep-awake holders', () => {
  let awake: Awake

  beforeEach(async () => {
    h.started.clear()
    h.starts = 0
    vi.resetModules()
    awake = await import('./awake')
  })

  it('stays awake while anyone still holds it', () => {
    awake.acquireAwake('queue')
    awake.acquireAwake('delivery:a')
    awake.releaseAwake('queue')
    expect(h.started.size).toBe(1)

    awake.releaseAwake('delivery:a')
    expect(h.started.size).toBe(0)
  })

  it('starts one blocker however many hold it, or however often', () => {
    awake.acquireAwake('queue')
    awake.acquireAwake('queue')
    awake.acquireAwake('delivery:a')
    expect(h.starts).toBe(1)
  })

  // The queue re-announces itself on every progress event; once idle is idle.
  it('is let go by one release, however many times it was taken', () => {
    awake.acquireAwake('queue')
    awake.acquireAwake('queue')
    awake.releaseAwake('queue')
    expect(h.started.size).toBe(0)
  })

  it('ignores a release from somebody who never held it', () => {
    awake.acquireAwake('queue')
    awake.releaseAwake('delivery:never')
    expect(h.started.size).toBe(1)
  })
})
