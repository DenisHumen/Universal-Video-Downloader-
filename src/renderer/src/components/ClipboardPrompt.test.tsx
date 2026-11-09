import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import App from '../App'
import { useI18n } from '../i18n'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'

// A host the engine reads by name: the kind the clipboard strip would look at ahead.
const LINK = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

describe('a link sent from outside the app', () => {
  beforeAll(() => installMockApi())
  beforeEach(() => {
    useI18n.getState().setLanguage('en')
    useStore.setState({ view: 'downloads', clipboardLink: null, clipboardLinkSent: false, pendingUrl: null })
    vi.restoreAllMocks()
  })

  async function app(): Promise<void> {
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    await window.api.setSettings({ setupDone: true, autoDownload: true })
    act(() => useStore.getState().setSetupOpen(false))
  }

  it('only offers: no request and no download, whatever the settings say, until somebody chooses it', async () => {
    const detect = vi.spyOn(window.api, 'detect')
    const download = vi.spyOn(window.api, 'startDownload')
    await app()
    act(() => window.__uvdMock!.sendLink(LINK))

    expect(await screen.findByText('Link from a browser or another program')).toBeTruthy()
    expect(screen.getByText(LINK)).toBeTruthy()
    expect(useStore.getState().view).toBe('downloads')
    expect(detect).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(await axeViolations(document.body)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Use It' }))
    expect(useStore.getState().view).toBe('home')
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    expect(detect.mock.calls[0][0]).toBe(LINK)
    // The whole detect, since somebody is now waiting; and that is as far as it goes.
    expect(detect.mock.calls[0][2]).toBeUndefined()
    expect(download).not.toHaveBeenCalled()
  })

  it('does not fetch anything for a flood, each link only replacing the last', async () => {
    const detect = vi.spyOn(window.api, 'detect')
    await app()
    act(() => {
      for (let i = 0; i < 100; i++) window.__uvdMock!.sendLink(`https://example.com/${i}`)
    })
    expect(await screen.findByText('https://example.com/99')).toBeTruthy()
    expect(screen.queryByText('https://example.com/98')).toBeNull()
    expect(detect).not.toHaveBeenCalled()
  })

  it('leaves the clipboard strip as it was: a link somebody copied is still looked at ahead', async () => {
    const detect = vi.spyOn(window.api, 'detect')
    await app()
    act(() => useStore.setState({ clipboardLink: `${LINK}&t=1`, clipboardLinkSent: false }))
    expect(await screen.findByText('Link on your clipboard')).toBeTruthy()
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    expect(detect.mock.calls[0][2]).toEqual({ prefetch: true })
  })
})
