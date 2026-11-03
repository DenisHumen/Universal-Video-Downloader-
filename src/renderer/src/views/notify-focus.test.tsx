import { act, render, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/* 6.4: everywhere, clicking a notification focuses the app on that row. */

beforeAll(() => {
  installMockApi()
  window.__uvdMock!.queue({ id: 'n1', title: 'Notified one', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/n1.mp4' })
})

describe('a notification click (6.4)', () => {
  it('opens Activity with the row in view, pulsed once', async () => {
    useStore.setState({ view: 'home' })
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    act(() => useStore.getState().focusRow('n1'))
    expect(useStore.getState().view).toBe('downloads')
    await waitFor(() => expect(document.querySelector('[data-row="n1"]')?.classList.contains('ui-row-pulse')).toBe(true))
    expect(useStore.getState().focusedRow).toBeNull()
  })
})
