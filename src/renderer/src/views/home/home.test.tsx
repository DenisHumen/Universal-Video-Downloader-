import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../../lib/mockApi'
import { useStore } from '../../store'
import App from '../../App'
import { SEARCH_DEBOUNCE_MS } from './hooks'

/*
  5.4: the Download entry takes a link, several lines or a title. A title is
  searched inline (Enter, or after a 400 ms pause) with a few results and
  "See All in Search"; a link becomes the GNOME result card.
*/

beforeAll(() => installMockApi())
beforeEach(() => useStore.setState({ view: 'home' }))
afterEach(() => vi.useRealTimers())

async function app(): Promise<HTMLInputElement> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
  return (await screen.findByRole('textbox', { name: /search by title/i })) as HTMLInputElement
}

describe('Download: inline search (5.4)', () => {
  it('does not search a title until typing pauses, then shows a handful of results', async () => {
    const spy = vi.spyOn(window.api, 'searchVideos')
    const input = await app()
    fireEvent.change(input, { target: { value: 'big buck bunny' } })
    expect(spy).not.toHaveBeenCalled()
    await waitFor(() => expect(spy).toHaveBeenCalledWith('big buck bunny', 'all', 5), {
      timeout: SEARCH_DEBOUNCE_MS + 1000
    })
    await screen.findByRole('button', { name: 'See All in Search' }, { timeout: 3000 })
    const group = screen.getByRole('region', { name: /Results for/ })
    const rows = group.querySelectorAll('button.ui-row')
    // Up to five results, then "See All in Search".
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.length).toBeLessThanOrEqual(6)
    spy.mockRestore()
  })

  it('never searches a link', async () => {
    const spy = vi.spyOn(window.api, 'searchVideos')
    const input = await app()
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=1' } })
    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 100))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('takes "See All in Search" to the Search view with the query', async () => {
    const input = await app()
    fireEvent.change(input, { target: { value: 'lofi' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const all = await screen.findByRole('button', { name: 'See All in Search' }, { timeout: 3000 })
    act(() => fireEvent.click(all))
    expect(useStore.getState().view).toBe('search')
  })
})

describe('Download: the result card (5.4, A1)', () => {
  it('shows format and quality rows, the save row and a pill that states the outcome', async () => {
    const input = await app()
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const pill = await screen.findByRole('button', { name: /^Download · / }, { timeout: 4000 })
    expect(pill.className).toContain('rounded-pill')
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Quality' })).toBeTruthy()
    expect(screen.getByText('Save To')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cut a Section' })).toBeTruthy()
  })

  it('sends the subtitles picked on the card, written or automatic, and never offers "all"', async () => {
    const input = await app()
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=subs' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const pill = await screen.findByRole('button', { name: /^Download · / }, { timeout: 4000 })
    expect(screen.getByText(/None\. Pick a language/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Subtitles' }))
    expect(screen.queryByRole('button', { name: /^all$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'German' }))
    fireEvent.click(screen.getByRole('button', { name: 'French' }))
    expect(screen.getByText('German, French')).toBeTruthy()
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await act(async () => fireEvent.click(pill))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0].subtitles).toEqual(['de', 'fr'])
  })
})
