import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MediaInfo } from '@shared/types'
import { deeperListing, MAX_LISTING_DEPTH } from '@shared/playlist'
import { installMockApi } from '../lib/mockApi'
import { detectCache, useStore } from '../store'
import PlaylistCard, { CONFIRM_ALL_ABOVE } from './PlaylistCard'

/* A list cut off by the listing depth says so; "Download All" on a big one asks first. */

const list = (count: number, cut?: number): MediaInfo => ({
  id: 'l',
  title: 'List',
  webpageUrl: 'https://example.com/list',
  originalUrl: 'https://example.com/list',
  extractor: 'YoutubeTab',
  isLive: false,
  formats: [],
  isPlaylist: true,
  playlistCount: count,
  entries: Array.from({ length: count }, (_, i) => ({ url: `https://example.com/v${i}`, title: `V${i}` })),
  ...(cut ? { listingCut: cut } : {})
})

const card = (info: MediaInfo): void => {
  render(<PlaylistCard info={info} onDone={() => undefined} saveDir="" onSaveDirChange={() => undefined} />)
}

beforeAll(async () => {
  installMockApi()
  useStore.setState({ settings: await window.api.getSettings() })
})
afterEach(() => vi.restoreAllMocks())

describe('a list cut off at the listing depth', () => {
  it('says nothing when the list ended on its own', () => {
    card(list(5))
    expect(screen.queryByRole('button', { name: 'Load More' })).toBeNull()
  })

  it('lists deeper past the cache, and keeps what was ticked', async () => {
    const stale = vi.spyOn(detectCache, 'get')
    const detect = vi
      .spyOn(window.api, 'detect')
      .mockResolvedValueOnce({ ok: true, info: list(8) })
    card(list(5, 5))
    expect(screen.getByRole('status').textContent).toMatch(/first 5/)
    fireEvent.click(screen.getByRole('button', { name: /V2$/ }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load More' })))
    expect(detect.mock.calls[0][0]).toBe('https://example.com/list')
    expect(detect.mock.calls[0][2]).toEqual({ playlistEnd: 10 })
    expect(stale).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download All (8)' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Download Selected (1)' })).toBeTruthy()
    // It ended before the new depth, so the notice goes.
    expect(screen.queryByRole('button', { name: 'Load More' })).toBeNull()
    // And the next visit to the link finds the longer list.
    stale.mockRestore()
    expect(detectCache.get('https://example.com/list')?.info?.entries).toHaveLength(8)
  })

  it('keeps the list on screen when the deeper listing fails', async () => {
    vi.spyOn(window.api, 'detect').mockResolvedValueOnce({ ok: false, error: 'no' })
    card(list(5, 5))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load More' })))
    expect(screen.getByRole('button', { name: 'Download All (5)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load More' })).toBeTruthy()
  })

  it('can be called off', async () => {
    vi.spyOn(window.api, 'detect').mockReturnValue(new Promise(() => undefined))
    const cancel = vi.spyOn(window.api, 'cancelDetect')
    card(list(5, 5))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load More' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Load More' })).toBeTruthy()
  })

  it('stops offering more at the deepest listing', () => {
    expect(deeperListing(500)).toBe(1000)
    expect(deeperListing(15_000)).toBe(MAX_LISTING_DEPTH)
    expect(deeperListing(MAX_LISTING_DEPTH)).toBeNull()
    card(list(3, MAX_LISTING_DEPTH))
    expect(screen.queryByRole('button', { name: 'Load More' })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/as deep as the app goes/)
  })
})

describe('Download All', () => {
  it('starts a short list straight away', async () => {
    const start = vi.spyOn(window.api, 'startDownload')
    card(list(CONFIRM_ALL_ABOVE))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Download All/ })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks first above the line, stating the count, and Cancel queues nothing', async () => {
    const start = vi.spyOn(window.api, 'startDownload')
    const count = CONFIRM_ALL_ABOVE + 1
    card(list(count))
    fireEvent.click(screen.getByRole('button', { name: `Download All (${count})` }))
    expect(screen.getByRole('alertdialog').textContent).toContain(String(count))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(start).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
