import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry } from '@shared/library'
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

describe('a library longer than one page', () => {
  it('fetches the next page as the end nears, and asks about each page’s files', async () => {
    const page = (offset: number, limit: number): { entries: LibraryEntry[]; total: number } => ({
      total: 250,
      entries: Array.from({ length: Math.min(limit, 250 - offset) }, (_, i) => ({
        id: `e${offset + i}`,
        filepath: `/v/${offset + i}.mp4`,
        url: 'https://example.com/v',
        title: `Video ${offset + i}`,
        finishedAt: 1_000_000 - offset - i
      }))
    })
    const list = vi.spyOn(window.api, 'listLibrary').mockImplementation(async (q) => page(q.offset ?? 0, q.limit ?? 100))
    const missing = vi.spyOn(window.api, 'libraryMissing')
    let reveal: () => void = () => undefined
    const real = window.IntersectionObserver
    window.IntersectionObserver = class {
      constructor(cb: IntersectionObserverCallback) {
        reveal = () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof IntersectionObserver
    try {
      await app()
      act(() => useStore.getState().setView('library'))
      await screen.findByText('Video 99')
      expect(screen.queryByText('Video 100')).toBeNull()
      expect(list.mock.lastCall?.[0]).toMatchObject({ offset: 0, limit: 100 })
      await act(async () => reveal())
      await screen.findByText('Video 199')
      expect(list.mock.lastCall?.[0]).toMatchObject({ offset: 100, limit: 100 })
      expect(missing.mock.lastCall?.[0]).toContain('/v/199.mp4')
      expect(missing.mock.lastCall?.[0]).not.toContain('/v/0.mp4')
    } finally {
      window.IntersectionObserver = real
      list.mockRestore()
      missing.mockRestore()
    }
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

  it('offers Locate… on a missing file, and choosing the file by hand when the folder has no match', async () => {
    const mock = window.__uvdMock!
    mock.queue({ id: 'lost', title: 'Lost film', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/lost.mp4' })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Lost film')
    act(() => mock.missing(['/v/lost.mp4']))
    await screen.findByText('File Missing')
    const locate = vi.spyOn(window.api, 'locateLibraryEntry')
    mock.locate('noMatch')
    await act(async () => fireEvent.click(document.querySelector('[data-row="lost"] [aria-haspopup="menu"]')!))
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Locate…' })))
    screen.getByRole('alertdialog', { name: 'No File with That Name' })
    mock.locate('found')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Choose the File…' })))
    expect(locate.mock.calls).toEqual([
      ['lost', 'folder'],
      ['lost', 'file']
    ])
    await waitFor(() => expect(screen.queryByText('File Missing')).toBeNull())
    locate.mockRestore()
    await act(async () => mock.missing([]))
  })

  it('forgets all missing files only after saying no file is touched', async () => {
    const mock = window.__uvdMock!
    mock.queue({ id: 'bye', title: 'Gone for good', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/bye.mp4' })
    mock.queue({ id: 'away', title: 'On a share', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/away.mp4', remotePath: 'share/away.mp4' })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Gone for good')
    act(() => mock.missing(['/v/bye.mp4', '/v/away.mp4']))
    fireEvent.click(await screen.findByRole('button', { name: 'Forget All Missing' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Forget All Missing Files?' })
    expect(dialog.textContent).toMatch(/no file on disk is touched/)
    expect(dialog.textContent).toMatch(/missing files: 1\b/)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forget Them' })))
    await waitFor(() => expect(screen.queryByText('Gone for good')).toBeNull())
    expect(screen.getByText('On a share')).toBeTruthy()
    await act(async () => mock.missing([]))
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
