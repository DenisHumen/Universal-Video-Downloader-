import { beforeEach, describe, expect, it } from 'vitest'
import { installMockApi } from './mockApi'
import { useStore } from '../store'
import { useToasts } from './toast'
import { queueDownload, queueDownloads } from './queue'

/*
  Plan 6.1: starting a download never takes the user to the queue. One toast
  says it was added and carries "view in queue"; only that press navigates.
*/

beforeEach(() => {
  installMockApi()
  useStore.setState({ view: 'search' })
  useToasts.setState({ toasts: [] })
})

describe('queueing a download', () => {
  it('stays on the current screen and offers the queue on the toast', async () => {
    expect(
      await queueDownload({ url: 'https://example.com/a', title: 'A', mode: 'video', quality: 'best' })
    ).toBe(true)
    expect(useStore.getState().view).toBe('search')
    const [only, ...rest] = useToasts.getState().toasts
    expect(rest).toEqual([])
    expect(only.kind).toBe('success')
    expect(only.action?.label).toBe('view in activity')
    only.action!.run()
    expect(useStore.getState().view).toBe('downloads')
  })

  it('does the same for a batch', async () => {
    await queueDownloads([
      { url: 'https://example.com/b', title: 'B', mode: 'video', quality: 'best' },
      { url: 'https://example.com/c', title: 'C', mode: 'video', quality: 'best' }
    ])
    expect(useStore.getState().view).toBe('search')
    expect(useToasts.getState().toasts).toHaveLength(1)
    expect(useToasts.getState().toasts[0].action).toBeTruthy()
  })
})
