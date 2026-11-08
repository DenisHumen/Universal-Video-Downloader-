import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry } from '@shared/library'
import type { MediaInfo } from '@shared/types'
import PlaylistCard from '../components/PlaylistCard'
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
      await screen.findByText('Video 99', undefined, { timeout: 8000 })
      expect(screen.queryByText('Video 100')).toBeNull()
      expect(list.mock.lastCall?.[0]).toMatchObject({ offset: 0, limit: 100 })
      await act(async () => reveal())
      // The slowest build machine can take over a second to draw a hundred rows.
      await screen.findByText('Video 199', undefined, { timeout: 8000 })
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

describe('the same actions in both lists', () => {
  const openMenu = (id: string): Promise<void> =>
    act(async () => {
      fireEvent.click(document.querySelector(`[data-row="${id}"] [aria-haspopup="menu"]`)!)
    })

  it('offers Copy Link and Open Source Page in the Library only for real web addresses', async () => {
    const q = window.__uvdMock!.queue
    q({ id: 'web', title: 'From a page', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/web.mp4', sourceUrl: 'https://example.com/a' })
    q({ id: 'internal', title: 'From a resolver', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/in.mp4', url: 'uvd-rezka://1', sourceUrl: 'uvd-rezka://1' })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('From a page')
    await openMenu('web')
    expect(screen.getByRole('menuitem', { name: 'Copy the Link' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open the Source Page' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await openMenu('internal')
    expect(screen.queryByRole('menuitem', { name: 'Copy the Link' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Download Again' })).toBeNull()
  })

  it('takes a clip’s Download Again back to the page its source came from', async () => {
    window.__uvdMock!.queue({
      id: 'clip',
      kind: 'trim',
      title: 'A clip',
      state: 'completed',
      percent: 100,
      finishedAt: Date.now(),
      url: '/v/source.mp4',
      sourcePath: '/v/source.mp4',
      originUrl: 'https://example.com/original',
      filepath: '/v/source (clip).mp4'
    })
    await app()
    act(() => useStore.getState().setView('downloads'))
    await screen.findByText('A clip')
    await openMenu('clip')
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Download Again' })))
    await waitFor(() => expect(useStore.getState().view).toBe('home'))
  })

  it('deletes a finished row’s file after asking, and the row goes with it', async () => {
    window.__uvdMock!.queue({ id: 'del', title: 'Delete me', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/del.mp4' })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Delete me')
    act(() => useStore.getState().setView('downloads'))
    await screen.findByText('Delete me')
    await openMenu('del')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete File…' }))
    screen.getByRole('alertdialog', { name: 'Delete This File?' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' })))
    await waitFor(() => expect(screen.queryByText('Delete me')).toBeNull())
  })

  it('says so when the Library has no entry for the row, and keeps the row', async () => {
    window.__uvdMock!.queue({ id: 'orphan', title: 'Not in the Library', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/orphan.mp4' })
    await window.api.listLibrary({})
    await window.api.forgetLibraryEntry('orphan')
    await app()
    act(() => useStore.getState().setView('downloads'))
    await screen.findByText('Not in the Library')
    await openMenu('orphan')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete File…' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' })))
    await screen.findByText(/no longer in the Library/)
    expect(screen.getByText('Not in the Library')).toBeTruthy()
  })
})

describe('you already have this', () => {
  const detect = async (link: string): Promise<void> => {
    await app()
    act(() => useStore.getState().requestDetect(link))
    await screen.findByRole('button', { name: /^(Download|Trim) ·|^Download Anyway/ }, { timeout: 3000 })
  }

  it('says so on the result card, with Play, Show in Folder and Download Anyway', async () => {
    const link = 'https://example.com/watch?v=kept'
    window.__uvdMock!.queue({ id: 'kept', title: 'Kept', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/kept.mp4', url: link, sourceUrl: link })
    await detect(link)
    await screen.findByText('You Already Have This')
    const card = document.querySelector('[data-uvd="already-have"]')!
    expect(within(card as HTMLElement).getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(within(card as HTMLElement).getByRole('button', { name: 'Show in Folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Download Anyway/ })).toBeTruthy()
  })

  it('marks a playlist’s rows that are kept, and only those', async () => {
    const kept = 'https://example.com/watch?v=ep1'
    window.__uvdMock!.queue({ id: 'ep1', title: 'Episode one', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/ep1.mp4', url: kept, sourceUrl: kept })
    const info = {
      id: 'p',
      title: 'A playlist',
      webpageUrl: 'https://example.com/list',
      extractor: 'example',
      isPlaylist: true,
      formats: [],
      entries: [
        { url: `${kept}&utm_source=shared`, title: 'Episode one' },
        { url: 'https://example.com/watch?v=ep2', title: 'Episode two' }
      ]
    } as unknown as MediaInfo
    await app()
    render(<PlaylistCard info={info} onDone={() => undefined} saveDir="" onSaveDirChange={() => undefined} />)
    const row = (await screen.findByText('In Library')).closest('button')!
    expect(row.textContent).toMatch(/Episode one/)
    expect(screen.getAllByText('In Library')).toHaveLength(1)
  })

  it('stays quiet about a link whose file is gone', async () => {
    const link = 'https://example.com/watch?v=lost'
    window.__uvdMock!.queue({ id: 'lost2', title: 'Lost', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/lost2.mp4', url: link, sourceUrl: link })
    window.__uvdMock!.missing(['/v/lost2.mp4'])
    await detect(link)
    await act(async () => undefined)
    expect(screen.queryByText('You Already Have This')).toBeNull()
    window.__uvdMock!.missing([])
  })

  it('offers no Play for a file on a share', async () => {
    const link = 'https://example.com/watch?v=sent'
    window.__uvdMock!.queue({ id: 'sent', title: 'Sent', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/sent.mp4', url: link, sourceUrl: link, remotePath: 'anime/sent.mp4' })
    window.__uvdMock!.missing(['/v/sent.mp4'])
    await detect(link)
    await screen.findByText('You Already Have This')
    expect(within(document.querySelector('[data-uvd="already-have"]') as HTMLElement).queryByRole('button', { name: 'Play' })).toBeNull()
    expect(screen.getByText(/anime\/sent\.mp4/)).toBeTruthy()
    window.__uvdMock!.missing([])
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

  it('shows a date as well as a time when grouped by site, and the length', async () => {
    const at = new Date(2021, 2, 9, 14, 30).getTime()
    window.__uvdMock!.queue({ id: 'dated', title: 'Dated film', state: 'completed', percent: 100, finishedAt: at, filepath: '/v/dated.mp4', extractor: 'zzz', duration: 3725 })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Dated film')
    const line = (): string => document.querySelector('[data-row="dated"] .ui-row-subtitle')!.textContent ?? ''
    expect(line()).toMatch(/1:02:05/)
    expect(line()).not.toMatch(/2021/)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Site' })))
    await waitFor(() => expect(line()).toMatch(/2021/))
    expect(line()).toMatch(/1:02:05/)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Date' })))
  })

  it('groups by series or channel, with what has neither under Other', async () => {
    const q = window.__uvdMock!.queue
    q({ id: 'ch', title: 'Channel video', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/ch.mp4', uploader: 'Some Channel' })
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('Channel video')
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Series or Channel' })))
    expect(await screen.findByRole('heading', { name: 'Some Channel' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Other' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Date' })))
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

  it('offers to fix the others found in the same folder, and says how many', async () => {
    const mock = window.__uvdMock!
    const row = (id: string): Parameters<typeof mock.queue>[0] => ({ id, title: id, state: 'completed', percent: 100, finishedAt: Date.now(), filepath: `/moved/${id}.mp4` })
    mock.queue(row('m1'))
    mock.queue(row('m2'))
    mock.queue(row('m3'))
    await app()
    act(() => useStore.getState().setView('library'))
    await screen.findByText('m1')
    act(() => mock.missing(['/moved/m1.mp4', '/moved/m2.mp4', '/moved/m3.mp4']))
    await screen.findAllByText('File Missing')
    await act(async () => fireEvent.click(document.querySelector('[data-row="m1"] [aria-haspopup="menu"]')!))
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Locate…' })))
    const ask = await screen.findByRole('alertdialog', { name: 'Fix the Others Too?' })
    expect(ask.textContent).toContain(': 2.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update Them' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Update Them' })))
    await waitFor(() => expect(screen.queryByText('File Missing')).toBeNull())
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
