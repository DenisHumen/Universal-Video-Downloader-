import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_CAP_PER_SERVICE, type SearchResult } from '@shared/types'
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

  describe('Show More', () => {
    const row = (n: number, service: SearchResult['service'] = 'bilibili'): SearchResult => ({
      id: String(n),
      title: `Result ${n}`,
      url: `https://example.com/${n}`,
      service
    })
    const rows = (from: number, to: number): SearchResult[] =>
      Array.from({ length: to - from + 1 }, (_, i) => row(from + i, 'youtube'))

    it('asks again at the cap, keeps what is there, probes only the new rows, and stops', async () => {
      const ask = vi.spyOn(window.api, 'searchVideos')
      ask.mockClear()
      // In the all-services scope six is the first page; a service that filled it may have more.
      ask.mockResolvedValueOnce({ ok: true, results: rows(1, 6) })
      ask.mockResolvedValueOnce({ ok: true, results: [...rows(1, 6), ...rows(7, 9)] })
      const probe = vi.spyOn(window.api, 'detect')
      probe.mockClear()
      await search('more please')
      const more = await screen.findByRole('button', { name: 'Show More' }, { timeout: 3000 })
      expect(ask).toHaveBeenLastCalledWith('more please', 'all', 6)
      await act(async () => fireEvent.click(more))
      await waitFor(() => expect(screen.getByText('Result 9')).toBeTruthy())
      expect(ask).toHaveBeenLastCalledWith('more please', 'all', SEARCH_CAP_PER_SERVICE)
      expect(screen.getAllByText(/^Result \d$/)).toHaveLength(9)
      // At the cap: nothing further to offer.
      expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
      await waitFor(() => expect(probe.mock.calls.map((c) => c[0])).toContain('https://example.com/9'), { timeout: 5000 })
      const asked = probe.mock.calls.map((c) => c[0])
      expect(new Set(asked).size).toBe(asked.length)
    }, 15_000)

    it('is not offered when the first page did not fill up', async () => {
      vi.spyOn(window.api, 'searchVideos').mockResolvedValueOnce({ ok: true, results: [row(1), row(2)] })
      await search('a rare thing')
      await screen.findByText('Result 2', undefined, { timeout: 3000 })
      expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
    })

    it('keeps the results and the button when asking again fails', async () => {
      const ask = vi.spyOn(window.api, 'searchVideos')
      ask.mockResolvedValueOnce({ ok: true, results: Array.from({ length: 6 }, (_, i) => row(i + 1)) })
      ask.mockResolvedValueOnce({ ok: false, error: 'no' })
      await search('flaky')
      const more = await screen.findByRole('button', { name: 'Show More' }, { timeout: 3000 })
      await act(async () => fireEvent.click(more))
      expect(screen.getByText('Result 6')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Show More' })).toBeTruthy()
    })
  })

  it('says so with a status page when nothing is found', async () => {
    vi.spyOn(window.api, 'searchVideos').mockResolvedValueOnce({ ok: true, results: [] })
    await search('zzzz')
    expect(await screen.findByRole('heading', { name: 'No Results Found' }, { timeout: 3000 })).toBeTruthy()
  })
})
