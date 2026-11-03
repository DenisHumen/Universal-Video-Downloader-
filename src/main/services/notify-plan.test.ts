import { describe, expect, it } from 'vitest'
import { planNotification } from './notify-plan'

describe('notifications per OS (6.4)', () => {
  const done = { state: 'completed' as const, filepath: '/v/a.mp4' }
  const failed = { state: 'error' as const }

  it('macOS: Play and Show in Folder when done, Fix when failed', () => {
    expect(planNotification('darwin', done)).toEqual({ title: 'notify.done', actions: ['play', 'showInFolder'] })
    expect(planNotification('darwin', failed)).toEqual({ title: 'notify.failed', actions: ['fix'] })
    // Nothing to play without a file (an upload-only job).
    expect(planNotification('darwin', { state: 'completed' }).actions).toEqual([])
  })

  it('Windows is click-to-open and Linux has no actions', () => {
    for (const os of ['win32', 'linux'] as const) {
      expect(planNotification(os, done).actions).toEqual([])
      expect(planNotification(os, failed).actions).toEqual([])
    }
  })
})
