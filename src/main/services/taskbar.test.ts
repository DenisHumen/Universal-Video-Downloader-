import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { taskbarProgress } from './taskbar'

const row = (state: DownloadItem['state'], percent = 0, indeterminate?: boolean) => ({
  state,
  percent,
  indeterminate
})

describe('taskbarProgress', () => {
  it('clears the bar when nothing is going on', () => {
    expect(taskbarProgress([])).toEqual({ value: -1, mode: 'none' })
    expect(taskbarProgress([row('completed', 100), row('error')])).toEqual({ value: -1, mode: 'none' })
  })

  it('averages what is running, ignoring what is waiting or done', () => {
    expect(
      taskbarProgress([row('downloading', 20), row('processing', 60), row('queued'), row('completed', 100)])
    ).toEqual({ value: 0.4, mode: 'normal' })
  })

  it('says working without a figure when no running item has one', () => {
    expect(taskbarProgress([row('downloading', 0, true)])).toEqual({ value: 2, mode: 'indeterminate' })
    expect(taskbarProgress([row('detecting')])).toEqual({ value: 2, mode: 'indeterminate' })
  })

  it('shows a queue that is only paused as paused', () => {
    expect(taskbarProgress([row('paused', 50), row('completed', 100)])).toEqual({ value: 0.5, mode: 'paused' })
  })
})
