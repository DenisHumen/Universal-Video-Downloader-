import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'
import { announcement } from '../components/LiveRegion'
import { useToasts } from '../lib/toast'
import { en } from '../i18n/en'

/* Things on these screens that have to do what they say, and ask only when asking is worth it. */

beforeEach(() => {
  installMockApi()
  useToasts.setState({ toasts: [] })
})

async function open(view: 'downloads' | 'home'): Promise<void> {
  useStore.setState({ view })
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
}

async function rowOf(title: string): Promise<HTMLElement> {
  return (await screen.findByText(title)).closest('li') as HTMLElement
}

describe('cancelling from the row', () => {
  it('goes at once when there is hardly anything to lose', async () => {
    window.__uvdMock!.queue({ id: 'young', title: 'Just started', state: 'downloading', percent: 4 })
    const cancel = vi.spyOn(window.api, 'cancelDownload')
    await open('downloads')
    fireEvent.click(within(await rowOf('Just started')).getByRole('button', { name: en['common.cancel'] }))
    expect(cancel).toHaveBeenCalledWith('young')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks first for a paused download, and backing out keeps it', async () => {
    window.__uvdMock!.queue({ id: 'held', title: 'Nearly there', state: 'paused', percent: 95 })
    const cancel = vi.spyOn(window.api, 'cancelDownload')
    await open('downloads')
    fireEvent.click(within(await rowOf('Nearly there')).getByRole('button', { name: en['common.cancel'] }))
    const dialog = screen.getByRole('alertdialog', { name: en['queue.cancelConfirm'] })
    expect(within(dialog).getByText(/95%/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en['common.cancel'] }))
    expect(cancel).not.toHaveBeenCalled()

    fireEvent.click(within(await rowOf('Nearly there')).getByRole('button', { name: en['common.cancel'] }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: en['queue.cancelButton'] }))
    expect(cancel).toHaveBeenCalledWith('held')
  })
})

describe('the clear buttons', () => {
  it('Clear Failed goes without a question, and is there for a cancelled row alone', async () => {
    window.__uvdMock!.queue({ id: 'off', title: 'Changed my mind', state: 'canceled' })
    const clear = vi.spyOn(window.api, 'clearFailed')
    await open('downloads')
    await rowOf('Changed my mind')
    // Under Failed, so not Clear Finished's, and not one to retry with the failures.
    expect(screen.queryByTitle(en['queue.clearFinished'])).toBeNull()
    expect(screen.queryByRole('button', { name: en['queue.retryFailed'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['queue.clearFailed'] }))
    expect(clear).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('a finished file that has moved', () => {
  it('says so instead of doing nothing', async () => {
    window.__uvdMock!.queue({ id: 'moved', title: 'Moved away', state: 'completed', filepath: '/gone/a.mp4', finishedAt: Date.now() })
    vi.spyOn(window.api, 'showInFolder').mockResolvedValue(false)
    await open('downloads')
    fireEvent.click(within(await rowOf('Moved away')).getByRole('button', { name: en['common.showInFolder'] }))
    await waitFor(() => expect(useToasts.getState().toasts.map((x) => x.message)).toContain(en['queue.showFailed']))
  })
})

describe('Home', () => {
  it('gives the newest finished row its actions in words', async () => {
    window.__uvdMock!.queue({ id: 'n', title: 'Newest one', state: 'completed', filepath: '/d/n.mp4', finishedAt: Date.now() })
    await open('home')
    const row = await rowOf('Newest one')
    expect(within(row).getByText(en['common.open'])).toBeTruthy()
    expect(within(row).getByText(en['common.showInFolder'])).toBeTruthy()
  })

  it('names the way out for a link that will not work', async () => {
    window.__uvdMock!.queue({ id: 'n', title: 'Newest one', state: 'completed', filepath: '/d/n.mp4', finishedAt: Date.now() })
    await open('home')
    expect(await screen.findByRole('button', { name: new RegExp(en['home.openSiteHere'].replace('?', '\\?')) })).toBeTruthy()
  })
})

describe('a failed detect', () => {
  async function failWith(errorCode: string): Promise<HTMLElement> {
    vi.spyOn(window.api, 'detect').mockResolvedValue({ ok: false, error: 'It broke', errorCode } as never)
    await open('home')
    const input = await screen.findByRole('textbox', { name: /search by title/i })
    fireEvent.change(input, { target: { value: 'https://media.example/watch/1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    return (await screen.findByText(en['home.errorTitle'])).closest('.panel') as HTMLElement
  }
  const solid = (card: HTMLElement): string[] =>
    [...card.querySelectorAll('.btn-solid')].map((b) => b.textContent?.trim() ?? '')

  it('leads with the fix the failure calls for, and puts the rest under Other Options', async () => {
    const card = await failWith('diskFull')
    expect(solid(card)).toEqual([en['fix.changeFolder']])
    expect(within(card).queryByRole('button', { name: en['common.retry'] })).toBeNull()
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: en['home.otherOptions'] })))
    expect(screen.getByRole('menuitem', { name: en['common.retry'] })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: en['fix.copyError'] })).toBeTruthy()
  })

  it('leads with Retry for a dropped connection, with the proxy one step away', async () => {
    const card = await failWith('network')
    expect(solid(card)).toEqual([en['common.retry']])
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: en['home.otherOptions'] })))
    expect(screen.getByRole('menuitem', { name: en['fix.proxy'] })).toBeTruthy()
  })
})

describe('what a screen reader is told', () => {
  it('does not double a full stop when outcomes are joined', () => {
    expect(announcement(['A failed. Press Retry.', 'B finished downloading'])).toBe('A failed. Press Retry. B finished downloading')
    expect(announcement(['A failed. Press Retry.'])).toBe('A failed. Press Retry')
  })
})
