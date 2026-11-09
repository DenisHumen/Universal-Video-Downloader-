import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppSettings, MediaInfo, VideoFormat } from '@shared/types'
import { installMockApi } from '../../lib/mockApi'
import VideoResult, { type ResultChoice } from './VideoResult'

/*
  The card says whether a download will fit before the click, against the folder
  it would really go to. The room is the mock's: a folder with "small" in its name
  has 50 MB.
*/

const formats = (over: Partial<VideoFormat>): VideoFormat[] => [
  { id: 'v', ext: 'mp4', kind: 'video+audio', resolution: '720p', height: 720, ...over }
]

const info = (fmts: VideoFormat[], extra: Partial<MediaInfo> = {}): MediaInfo => ({
  id: 'x',
  title: 'A video',
  webpageUrl: 'https://example.com/x',
  originalUrl: 'https://example.com/x',
  extractor: 'generic',
  isLive: false,
  formats: fmts,
  ...extra
})

const choice = (over: Partial<ResultChoice> = {}): ResultChoice => ({
  selection: { mode: 'video', quality: 'best' },
  trimOn: false,
  section: {},
  precise: true,
  ...over
})

const card = (media: MediaInfo, saveDir: string, picked: ResultChoice = choice()): void => {
  render(
    <VideoResult
      info={media}
      settings={{ downloadDir: 'D:/roomy', audioFormat: 'mp3', subtitleLanguages: '' } as unknown as AppSettings}
      choice={picked}
      onChoice={vi.fn()}
      onAudioFormat={vi.fn()}
      saveDir={saveDir}
      onSaveDir={vi.fn()}
      onDownload={vi.fn()}
      starting={false}
    />
  )
}

const ask = () => vi.spyOn(window.api, 'freeSpace')

beforeAll(() => installMockApi())
afterEach(cleanup)

describe('room on the disk, on the card', () => {
  it('says it will not fit, with the figures, for a stated size', async () => {
    card(info(formats({ filesize: 900_000_000 })), 'D:/small')
    expect(await screen.findByText('Not Enough Room in This Folder')).toBeTruthy()
    expect(screen.getByText(/It needs about 8\d\d(\.\d)? MB while downloading/)).toBeTruthy()
  })

  it('says only that it may not, for an approximate one', async () => {
    card(info(formats({ filesizeApprox: 900_000_000 })), 'D:/small')
    expect(await screen.findByText('This May Not Fit in This Folder')).toBeTruthy()
  })

  it('works one out from length and bitrate', async () => {
    card(info(formats({ tbr: 8_000 }), { duration: 3_600 }), 'D:/small')
    expect(await screen.findByText('This May Not Fit in This Folder')).toBeTruthy()
  })

  it('says nothing when it fits', async () => {
    const spy = ask()
    card(info(formats({ filesize: 900_000_000 })), '')
    await waitFor(() => expect(spy).toHaveBeenCalledWith('D:/roomy'))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Not Enough Room in This Folder')).toBeNull()
  })

  it('says nothing when no size is known', async () => {
    card(info(formats({})), 'D:/small')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/in This Folder/)).toBeNull()
  })

  it('says nothing when the disk will not answer', async () => {
    const spy = ask().mockResolvedValueOnce(undefined)
    card(info(formats({ filesize: 900_000_000 })), 'D:/small')
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/in This Folder/)).toBeNull()
  })

  it('leaves the button on, since the row is what refuses', async () => {
    card(info(formats({ filesize: 900_000_000 })), 'D:/small')
    await screen.findByText('Not Enough Room in This Folder')
    const button = document.querySelector('[data-uvd="download"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('does not hold a whole file against a cut', async () => {
    card(info(formats({ filesize: 900_000_000 })), 'D:/small', choice({ trimOn: true, section: { start: 1, end: 2 } }))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/in This Folder/)).toBeNull()
  })
})
