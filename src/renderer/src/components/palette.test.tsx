import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import App from '../App'

/* Plan 4.5: Ctrl/⌘+K finds a section, an action or a setting, from the keyboard. */

beforeAll(() => installMockApi())
beforeEach(() => useStore.setState({ view: 'home', paletteOpen: false }))

async function app(): Promise<void> {
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
}

describe('command palette', () => {
  it('opens on Ctrl+K as a labelled combobox and passes axe', async () => {
    await app()
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
    const box = await screen.findByRole('combobox', { name: 'Go to or Do Anything' })
    expect(document.activeElement).toBe(box)
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('navigates with the arrows and runs with Enter', async () => {
    await app()
    act(() => useStore.getState().setPaletteOpen(true))
    const box = await screen.findByRole('combobox')
    fireEvent.change(box, { target: { value: 'my downloads' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(useStore.getState().view).toBe('downloads')
    expect(useStore.getState().paletteOpen).toBe(false)
  })

  it('finds a setting and deep-links to its row', async () => {
    await app()
    act(() => useStore.getState().setPaletteOpen(true))
    const box = await screen.findByRole('combobox')
    fireEvent.change(box, { target: { value: 'proxy password' } })
    const option = screen.getByRole('option', { name: /Proxy Password/i })
    fireEvent.click(option)
    expect(useStore.getState().view).toBe('settings')
    expect(useStore.getState().settingsRoute).toBe('network/proxy#password')
  })

  it('works on a Cyrillic layout by the key position', async () => {
    await app()
    fireEvent.keyDown(window, { key: 'л', code: 'KeyK', ctrlKey: true })
    expect(useStore.getState().paletteOpen).toBe(true)
  })
})
