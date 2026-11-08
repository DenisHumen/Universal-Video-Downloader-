import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SmbTarget } from '@shared/automation'
import type { AppSettings, DownloadItem } from '@shared/types'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import EngineOutput from './EngineOutput'
import QueueRow from './QueueRow'
import SendToShareDialog from './SendToShareDialog'

beforeAll(() => installMockApi())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const target: SmbTarget = {
  id: 'nas',
  name: 'NAS',
  host: '192.168.1.10',
  share: 'media',
  path: 'video',
  domain: '',
  username: 'u'
}

function withShares(smbTargets: SmbTarget[]): void {
  useStore.setState({ settings: { ...(useStore.getState().settings as AppSettings), smbTargets } })
}

const row = (overrides: Partial<DownloadItem>): DownloadItem => ({
  id: 'row',
  url: 'https://example.com/live',
  title: 'A broadcast',
  mode: 'video',
  state: 'downloading',
  percent: 0,
  outputDir: '/downloads',
  createdAt: 0,
  ...overrides
})

const show = (item: DownloadItem): void =>
  void render(
    <ul>
      <QueueRow item={item} index={0} />
    </ul>
  )

describe('Stop and Save on a queue row', () => {
  it('replaces pause on a live recording, in words', () => {
    const stop = vi.spyOn(window.api, 'stopLiveRecording')
    show(row({ live: true }))
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and Save' }))
    expect(stop).toHaveBeenCalledWith('row')
    expect(screen.getByText(/Recording until you stop it/)).toBeTruthy()
  })

  it('is on a paused recording too, beside resume', () => {
    show(row({ live: true, state: 'paused' }))
    expect(screen.getByRole('button', { name: 'Stop and Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('is on a recording that failed partway, but not on one that failed to save', () => {
    const paths = { live: true, state: 'error' as const, partialPaths: ['/downloads/rec.mp4'] }
    const { unmount } = render(
      <ul>
        <QueueRow item={row({ ...paths, errorCode: 'network' })} index={0} />
      </ul>
    )
    expect(screen.getByRole('button', { name: 'Stop and Save' })).toBeTruthy()
    unmount()
    show(row({ ...paths, errorCode: 'liveNotSaved', keptPartial: '/downloads/rec.mp4.part' }))
    expect(screen.queryByRole('button', { name: 'Stop and Save' })).toBeNull()
  })

  it('is not on an ordinary download', () => {
    show(row({}))
    expect(screen.queryByRole('button', { name: 'Stop and Save' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('goes away while saving, and the row says what it is doing', () => {
    show(row({ live: true, state: 'processing', savingLive: true }))
    expect(screen.queryByRole('button', { name: 'Stop and Save' })).toBeNull()
    expect(screen.getByText(/Saving the recording/)).toBeTruthy()
  })

  it('names the file when a recording could not be saved', () => {
    const shown = vi.spyOn(window.api, 'showInFolder')
    show(row({ live: true, state: 'error', errorCode: 'liveNotSaved', keptPartial: '/downloads/rec.mp4.part' }))
    expect(screen.getByText(/has not been deleted/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /rec\.mp4\.part/ }))
    expect(shown).toHaveBeenCalledWith('/downloads/rec.mp4.part')
  })
})

describe('EngineOutput', () => {
  it('keeps asking while the row runs, and shows the newest text', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(window.api, 'downloadLog').mockResolvedValueOnce('first line').mockResolvedValue('second line')
    render(<EngineOutput id="row" running />)
    await act(async () => vi.advanceTimersByTime(0))
    expect(screen.getByText('first line')).toBeTruthy()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByText('second line')).toBeTruthy()
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('asks once for a row that has stopped, and stops asking when closed', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(window.api, 'downloadLog').mockResolvedValue('')
    const { unmount } = render(<EngineOutput id="row" running={false} />)
    await act(async () => vi.advanceTimersByTime(5000))
    expect(log).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Nothing yet.')).toBeTruthy()
    unmount()
  })
})

describe('SendToShareDialog', () => {
  it('sends to the share\'s folder, and closes on success', async () => {
    withShares([target])
    const send = vi.spyOn(window.api, 'shareSend')
    const onClose = vi.fn()
    render(<SendToShareDialog id="row" title="A film" onClose={onClose} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    expect(send).toHaveBeenCalledWith({ id: 'row', targetId: 'nas', folder: 'video', replace: false })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before replacing, and a no leaves it alone', async () => {
    withShares([target])
    const send = vi.spyOn(window.api, 'shareSend').mockResolvedValue({ status: 'exists', name: 'film.mp4' })
    const onClose = vi.fn()
    render(<SendToShareDialog id="row" title="A film" onClose={onClose} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).pop()!))
    expect(send).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('sends again only after Replace is pressed', async () => {
    withShares([target])
    const send = vi
      .spyOn(window.api, 'shareSend')
      .mockResolvedValueOnce({ status: 'exists', name: 'film.mp4' })
      .mockResolvedValueOnce({ status: 'sent', remotePath: 'media/video/film.mp4' })
    const onClose = vi.fn()
    render(<SendToShareDialog id="row" title="A film" onClose={onClose} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Replace' })))
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows progress as it comes, and says why a send failed', async () => {
    withShares([target])
    let progress: (p: { id: string; bytes: number; total: number }) => void = () => undefined
    vi.spyOn(window.api, 'onShareSendProgress').mockImplementation((cb) => {
      progress = cb
      return () => undefined
    })
    let finish: (r: { status: 'failed'; kind: 'full'; message: string }) => void = () => undefined
    vi.spyOn(window.api, 'shareSend').mockReturnValue(new Promise((ok) => (finish = ok)))
    render(<SendToShareDialog id="row" title="A film" onClose={() => undefined} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    await act(async () => progress({ id: 'row', bytes: 50, total: 200 }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
    await act(async () => finish({ status: 'failed', kind: 'full', message: 'The share is full.' }))
    expect(screen.getByRole('alert').textContent).toBe('The share has no space left.')
  })
})

describe('the menu items', () => {
  it('offers sending on a finished row only when a share is set up', async () => {
    withShares([])
    const finished = row({ state: 'completed', filepath: '/downloads/a.mp4' })
    const { unmount } = render(
      <ul>
        <QueueRow item={finished} index={0} />
      </ul>
    )
    fireEvent.click(screen.getByRole('button', { name: 'More Actions' }))
    expect(screen.queryByText('Send to Share…')).toBeNull()
    unmount()

    withShares([target])
    show(finished)
    fireEvent.click(screen.getByRole('button', { name: 'More Actions' }))
    expect(await screen.findByText('Send to Share…')).toBeTruthy()
  })
})
