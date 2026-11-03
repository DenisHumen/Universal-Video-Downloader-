import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/* 5.5: the entry in the header bar, a toggle-group filter, poster cards, a StatusPage for nothing. */

beforeAll(() => installMockApi())
beforeEach(() => useStore.setState({ view: 'search' }))

async function search(q: string): Promise<void> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
  const entry = (await screen.findByRole('textbox', { name: 'Search by Title' })) as HTMLInputElement
  // In the header bar, not on the page.
  expect(entry.closest('.ui-headerbar')).toBeTruthy()
  fireEvent.change(entry, { target: { value: q } })
  fireEvent.keyDown(entry, { key: 'Enter' })
}

describe('Search (5.5)', () => {
  it('shows poster cards that open in the Download view’s card', async () => {
    await search('big buck bunny')
    const open = await screen.findAllByRole('button', { name: /^Open in Download: / }, { timeout: 3000 })
    expect(screen.getByRole('radiogroup', { name: 'Services' })).toBeTruthy()
    const detect = vi.spyOn(window.api, 'detect')
    act(() => fireEvent.click(open[0]))
    expect(useStore.getState().view).toBe('home')
    await waitFor(() => expect(detect).toHaveBeenCalled())
    expect(detect.mock.calls[0][0]).toMatch(/^https:\/\/example\.com\//)
  })

  it('says so with a status page when nothing is found', async () => {
    vi.spyOn(window.api, 'searchVideos').mockResolvedValueOnce({ ok: true, results: [] })
    await search('zzzz')
    expect(await screen.findByRole('heading', { name: 'No Results Found' }, { timeout: 3000 })).toBeTruthy()
  })
})
