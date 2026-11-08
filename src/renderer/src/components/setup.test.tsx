import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'
import { en } from '../i18n/en'

const SYSTEM = en['prefs.accent.system']

/* 6.3: first-run setup, two skippable steps, shown once, reachable from the primary menu. */

beforeEach(() => {
  installMockApi()
  useStore.setState({ view: 'home', setupOpen: false })
})

async function app(): Promise<void> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
}

describe('first-run setup (6.3)', () => {
  it('opens by itself on a new install and walks its steps, saving as it goes, and never asks about cookies', async () => {
    await window.api.setSettings({ setupDone: false })
    vi.spyOn(window.api, 'chooseDirectory').mockResolvedValue('/home/me/Films')
    await app()
    const dialog = await screen.findByRole('dialog', { name: 'Where Should Downloads Go?' })
    expect(within(dialog).getByText('Step 1 of 2')).toBeTruthy()
    // Every choice saves as it is made, so a Skip beside Next would do the same thing.
    expect(within(dialog).queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Skip Setup' })).toBeTruthy()
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /Change/ })))
    await waitFor(() => expect(useStore.getState().settings?.downloadDir).toBe('/home/me/Films'))
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Next' })))

    expect(useStore.getState().settings?.cookiesFromBrowser).toBe('')

    const look = screen.getByRole('dialog', { name: 'Notifications and Look' })
    expect(within(look).getByRole('switch', { name: 'Notifications' })).toBeTruthy()
    expect(within(look).getByRole('radiogroup', { name: 'Style' })).toBeTruthy()
    // The desktop answered the accent read (the mock reports one): "System" is offered.
    const accent = (): HTMLElement => within(screen.getByRole('dialog')).getByRole('radiogroup', { name: 'Accent Color' })
    expect(within(accent()).getByRole('radio', { name: SYSTEM })).toBeTruthy()
    // When the read failed (GNOME 46 has no portal accent key), it is hidden.
    const info = useStore.getState().appInfo!
    act(() => useStore.setState({ appInfo: { ...info, systemAccent: undefined } }))
    expect(within(accent()).queryByRole('radio', { name: SYSTEM })).toBeNull()
    expect(within(accent()).getByRole('radio', { name: 'Orange' })).toBeTruthy()
    act(() => useStore.setState({ appInfo: info }))
    await act(async () => fireEvent.click(within(look).getByRole('button', { name: 'Done' })))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(useStore.getState().settings?.setupDone).toBe(true))
  })

  it('does not open again once done, and the primary menu opens it', async () => {
    await window.api.setSettings({ setupDone: true })
    await app()
    expect(screen.queryByRole('dialog', { name: 'Where Should Downloads Go?' })).toBeNull()
    // The sidebar is an overlay at jsdom's width; open it as its toggle would.
    act(() => useStore.setState({ sidebarOverlayOpen: true }))
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Main Menu', hidden: true })[0]))
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Setup…' })))
    expect(screen.getByRole('dialog', { name: 'Where Should Downloads Go?' })).toBeTruthy()
  })

  it('can be skipped whole from the first step', async () => {
    await window.api.setSettings({ setupDone: false })
    await app()
    await act(async () => useStore.getState().saveSettings({ setupDone: false }))
    const dialog = await screen.findByRole('dialog', { name: 'Where Should Downloads Go?' })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Skip Setup' })))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(useStore.getState().settings?.setupDone).toBe(true))
  })
})
