import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/*
  6.2: a failed row in Activity offers the fix its error code calls for,
  beside Report and Copy Error.
*/

beforeAll(() => {
  installMockApi()
  const q = window.__uvdMock!.queue
  q({ id: 'gate', title: 'Members only clip', state: 'error', errorCode: 'signIn', error: 'Sign in to confirm', url: 'https://www.youtube.com/watch?v=gate' })
  q({ id: 'disk', title: 'Too big for the disk', state: 'error', errorCode: 'diskFull', error: 'No space left', url: 'https://www.youtube.com/watch?v=disk' })
  q({ id: 'limit', title: 'Rate limited one', state: 'error', errorCode: 'rateLimited', error: 'HTTP 429', url: 'https://www.youtube.com/watch?v=limit' })
  q({ id: 'soon', title: 'A premiere', state: 'error', errorCode: 'upcoming', error: 'Premieres in 3 days', url: 'https://www.youtube.com/watch?v=soon' })
  q({ id: 'held', title: 'Waiting premiere', state: 'waiting', waitForVideo: true, url: 'https://www.youtube.com/watch?v=held' })
  q({ id: 'nofmt', title: 'Podcast with no video', state: 'error', errorCode: 'noSuchFormat', error: 'Requested format is not available', url: 'https://www.youtube.com/watch?v=nofmt' })
})
beforeEach(() => useStore.setState({ view: 'downloads' }))

async function row(title: string): Promise<HTMLElement> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
  const text = await screen.findByText(title)
  return text.closest('li') as HTMLElement
}

describe('fix buttons on failed rows (6.2)', () => {
  it('signIn: "Sign In or Use Cookies…" picks a browser inline, saves it and retries', async () => {
    const r = await row('Members only clip')
    const retry = vi.spyOn(window.api, 'retryDownload')
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Sign In or Use Cookies…' })))
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Cookies From Firefox' })))
    await waitFor(() => expect(useStore.getState().settings?.cookiesFromBrowser).toBe('firefox'))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('gate'))
    // And the way to the full settings.
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Sign In or Use Cookies…' })))
    expect(screen.getByRole('menuitem', { name: 'Settings › Access & Cookies…' })).toBeTruthy()
  })

  it('upcoming: "Wait and Download" re-queues it to wait, and the old row goes', async () => {
    const r = await row('A premiere')
    const remove = vi.spyOn(window.api, 'removeDownload')
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Wait and Download' })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(remove).toHaveBeenCalledWith('soon')
    expect(start.mock.calls[0][0]).toMatchObject({ waitForVideo: true })
  })

  it('a row waiting says so plainly, and can be stopped', async () => {
    const r = await row('Waiting premiere')
    expect(within(r).getByText('Waiting to Start')).toBeTruthy()
    expect(within(r).getByText(/once it starts/)).toBeTruthy()
    expect(within(r).queryByRole('progressbar')).toBeNull()
    const cancel = vi.spyOn(window.api, 'cancelDownload')
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Cancel' })))
    expect(cancel).toHaveBeenCalledWith('held')
  })

  it('diskFull: "Change Folder" re-queues into the folder picked', async () => {
    const r = await row('Too big for the disk')
    vi.spyOn(window.api, 'chooseDirectory').mockResolvedValue('/mnt/big')
    const start = vi.spyOn(window.api, 'startDownload')
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Change Folder' })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0]).toMatchObject({ outputDir: '/mnt/big' })
  })

  it('noSuchFormat: "Audio Only" re-queues it as audio', async () => {
    const r = await row('Podcast with no video')
    const start = vi.spyOn(window.api, 'startDownload')
    start.mockClear()
    await act(async () => fireEvent.click(within(r).getByRole('button', { name: 'Audio Only' })))
    await waitFor(() => expect(start).toHaveBeenCalled())
    expect(start.mock.calls[0][0]).toMatchObject({ mode: 'audio', quality: 'audio' })
  })

  it('rateLimited: "Retry in 5 Min", and Copy Error, always', async () => {
    const r = await row('Rate limited one')
    const later = within(r).getByRole('button', { name: 'Retry in 5 Min' })
    await act(async () => fireEvent.click(later))
    expect(within(r).getByRole('button', { name: /^Retrying at/ })).toBeTruthy()
    expect(within(r).getByRole('button', { name: 'Copy Error' })).toBeTruthy()
  })
})
