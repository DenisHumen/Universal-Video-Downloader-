import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaInfo } from '@shared/types'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import StreamingCard from './StreamingCard'

/* A series' episodes get a folder of their own, the way a playlist's entries do. */

const series = (episodes: number[]): MediaInfo => ({
  id: 'x',
  title: 'Show',
  webpageUrl: 'https://example.com/show',
  originalUrl: 'https://example.com/show',
  extractor: 'YummyAnime',
  isLive: false,
  formats: [],
  streaming: {
    provider: 'yummyani',
    host: 'example.com',
    id: 'x',
    title: 'Show',
    isSeries: true,
    translators: [{ id: 'a', name: 'A dub' }],
    defaultTranslator: 'a',
    seasons: [{ season: 1, episodes }],
    qualities: ['720p']
  }
})

async function pick(info: MediaInfo, episode: string): Promise<void> {
  render(<StreamingCard info={info} onDone={() => undefined} saveDir="" onSaveDirChange={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: episode }))
}

beforeAll(() => installMockApi())
beforeEach(async () => {
  await useStore.getState().saveSettings({ playlistFolder: true })
  useStore.setState({ settings: await window.api.getSettings() })
})

describe('StreamingCard', () => {
  it('sends an episode with its place and the folder choice, never numbering the name', async () => {
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await pick(series([1, 2, 3]), '2')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Download Selected/ })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0].playlist).toEqual({ title: 'Show', index: 2, count: 3, folder: true, numbered: false })
  })

  it('keeps the folder for an episode 0 special', async () => {
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await pick(series([0, 1]), '0')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Download Selected/ })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0].playlist).toMatchObject({ index: 0, folder: true })
  })

  it('offers the folder as a remembered choice', async () => {
    await pick(series([1]), '1')
    const option = screen.getByRole('checkbox', { name: /Put them in a folder of their own/ })
    expect(option.getAttribute('aria-checked')).toBe('true')
    await act(async () => fireEvent.click(option))
    await waitFor(() => expect(useStore.getState().settings?.playlistFolder).toBe(false))
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Download Selected/ })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0].playlist?.folder).toBe(false)
  })
})
