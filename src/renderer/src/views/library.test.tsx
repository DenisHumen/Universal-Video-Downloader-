import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/*
  5.2 + 5.3: Activity is work in progress plus what finished today; the
  Library has every finished file, from its own store, and deleting one asks
  first and goes to the trash.
*/

const DAY = 86_400_000

beforeAll(() => {
  installMockApi()
  const q = window.__uvdMock!.queue
  q({ id: 'old', title: 'Finished last week', state: 'completed', percent: 100, finishedAt: Date.now() - 7 * DAY, filepath: '/v/old.mp4', extractor: 'youtube' })
  q({ id: 'new', title: 'Finished just now', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/new.mkv', extractor: 'vimeo' })
  q({ id: 'run', title: 'Still going', state: 'downloading', percent: 40 })
})
beforeEach(() => useStore.setState({ view: 'home' }))

async function app(): Promise<void> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
}

describe('Activity (5.2)', () => {
  it('shows work in progress and what finished today, not older finished files', async () => {
    await app()
    act(() => useStore.getState().setView('downloads'))
    expect(screen.getByText('Still going')).toBeTruthy()
    expect(screen.getByText('Finished just now')).toBeTruthy()
    expect(screen.queryByText('Finished last week')).toBeNull()
  })
})

describe('Library (5.3)', () => {
  it('lists every finished file, grouped by day', async () => {
    await app()
    act(() => useStore.getState().setView('library'))
    expect(await screen.findByText('Finished last week')).toBeTruthy()
    expect(screen.getByText('Finished just now')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('asks before deleting a file, then moves it to the trash', async () => {
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Finished last week')
    const rows = document.querySelectorAll('[data-row="old"] [aria-haspopup="menu"]')
    await act(async () => fireEvent.click(rows[0]))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete File…' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete This File?' })
    expect(dialog).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' })))
    await waitFor(() => expect(screen.queryByText('Finished last week')).toBeNull())
  })

  it('badges files finished elsewhere until the Library is opened', async () => {
    await app()
    act(() => useStore.setState({ libraryUnseen: 0, view: 'home' }))
    act(() => {
      window.__uvdMock!.queue({ id: 'later', title: 'Later', state: 'processing', percent: 99 })
    })
    await waitFor(() => expect(useStore.getState().downloads.some((d) => d.id === 'later')).toBe(true))
    act(() => {
      window.__uvdMock!.queue({ id: 'later', title: 'Later', state: 'completed', percent: 100, filepath: '/v/later.mp4', finishedAt: Date.now() })
    })
    await waitFor(() => expect(useStore.getState().libraryUnseen).toBe(1))
    act(() => useStore.getState().setView('library'))
    expect(useStore.getState().libraryUnseen).toBe(0)
  })
})
