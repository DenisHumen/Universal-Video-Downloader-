import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/* 5.6: rows with a poster (or a placeholder), the dub, the next check, a pause switch; "+" in the header; Telegram as its own group. */

beforeAll(async () => {
  installMockApi()
  await window.api.autoAdd({
    url: 'https://example.com/catalog/item/series', title: 'No Poster Show', provider: 'kodik', translatorId: 'a',
    translatorName: 'AniLibria', quality: '1080p', enabled: true, intervalMinutes: 360, nextCheckAt: Date.now() + 2 * 3600e3,
    failures: 0, seen: [{ season: 1, episode: 4 }, { season: 1, episode: 5 }],
    steps: [{ id: 'd', kind: 'download', enabled: true }]
  } as never)
})
beforeEach(() => useStore.setState({ view: 'automation' }))

describe('Watching (5.6)', () => {
  it('shows the series with its dub, next check, last new episode and a pause switch', async () => {
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    expect((await screen.findAllByText('No Poster Show')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/AniLibria · 1080p/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/next check in 2/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/S01E05/).length).toBeGreaterThan(0)
    const update = vi.spyOn(window.api, 'autoUpdate')
    const sw = screen.getByRole('switch', { name: /: No Poster Show$/ })
    await act(async () => fireEvent.click(sw))
    expect(update).toHaveBeenCalledWith(expect.any(String), { enabled: false })
    expect(screen.getByRole('heading', { name: 'Telegram' })).toBeTruthy()
  })

  it('opens the add dialog of entry rows from the header "+"', async () => {
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Watch a Series…' })))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('.ui-entry-row input')).toBeTruthy()
  })
})
