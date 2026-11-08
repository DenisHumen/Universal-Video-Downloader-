import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { axeViolations } from '../../../../../test/axe'
import { installMockApi } from '../../lib/mockApi'
import { useStore } from '../../store'
import App from '../../App'
import { en } from '../../i18n/en'
import { SEARCH_INDEX } from './searchIndex'
import { PANELS, SUBPAGES, formatRoute, parseRoute } from './router'

/*
  D8: Settings as GNOME Settings - three columns, folding, the narrow
  stack, deep links with the row pulse, search by panel › subpage › row,
  and an axe pass on every page.
*/

const realMatchMedia = window.matchMedia
function viewport(width: number): void {
  window.matchMedia = ((query: string) => {
    const min = query.match(/min-width:\s*(\d+)px/)
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  }) as unknown as typeof window.matchMedia
}

beforeAll(() => {
  installMockApi()
  // jsdom has no layout; scrollIntoView is all a deep link needs from it.
  Element.prototype.scrollIntoView = function () {}
})
beforeEach(() => useStore.setState({ view: 'home', settingsRoute: 'appearance', settingsDeepLinked: false, sidebarFolded: false }))
afterEach(() => {
  window.matchMedia = realMatchMedia
})

async function app(width: number): Promise<void> {
  viewport(width)
  render(<App />)
  await waitFor(() => expect(useStore.getState().ready).toBe(true))
}

describe('router', () => {
  it('parses deep links and falls back to what exists', () => {
    expect(parseRoute('network/proxy#password')).toEqual({ panel: 'network', sub: ['proxy'], row: 'password' })
    expect(parseRoute('system/about/legal')).toEqual({ panel: 'system', sub: ['about', 'legal'], row: undefined })
    expect(parseRoute('network/nowhere')).toEqual({ panel: 'network', sub: [], row: undefined })
    expect(parseRoute('nonsense')).toEqual({ panel: 'appearance', sub: [] })
    expect(formatRoute(parseRoute('downloads#saveLocation'))).toBe('downloads#saveLocation')
  })

  it('has eight panels, in GNOME-style groups', () => {
    expect(PANELS).toHaveLength(8)
    expect(Object.keys(SUBPAGES).every((k) => PANELS.some((p) => k.startsWith(p.id + '/')))).toBe(true)
  })
})

describe('layout', () => {
  it('is three columns from 1100 px: app sidebar, panel list, page', async () => {
    await app(1220)
    act(() => useStore.getState().openSettings())
    expect(useStore.getState().sidebarFolded).toBe(false)
    expect(document.querySelector('#uvd-sidebar')).not.toBeNull()
    expect(document.querySelector('[data-uvd="settings-list"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy()
  })

  it('folds the app sidebar at 860-1099 so the panel list is the only rail, and restores it on the way out', async () => {
    await app(1000)
    act(() => useStore.getState().openSettings())
    expect(useStore.getState().sidebarFolded).toBe(true)
    expect(document.querySelector('#uvd-sidebar')).toBeNull()
    expect(document.querySelector('[data-uvd="settings-list"]')).not.toBeNull()
    act(() => useStore.getState().setView('home'))
    expect(useStore.getState().sidebarFolded).toBe(false)
  })

  it('stacks below 860: the list first, a panel pushed over it, back to the list', async () => {
    await app(720)
    act(() => useStore.getState().setView('settings'))
    const list = document.querySelector<HTMLElement>('[data-uvd="settings-list"]')!
    expect(list).not.toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Network' }))
    expect(document.querySelector('[data-uvd="settings-list"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Network' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Proxy/ }))
    expect(screen.getByRole('heading', { name: 'Proxy' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Network' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(document.querySelector('[data-uvd="settings-list"]')).not.toBeNull()
  })
})

describe('the tray switch', () => {
  it('reads on and cannot be turned off while background checks keep the icon', async () => {
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    await act(async () => useStore.getState().saveSettings({ trayEnabled: false, automationEnabled: true }))
    act(() => useStore.getState().openSettings('system/startup'))
    const row = await screen.findByRole('switch', { name: en['settings.tray'] })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect((row as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(en['settings.trayImplied'])).toBeTruthy()
    await act(async () => useStore.getState().saveSettings({ automationEnabled: false }))
  })
})

describe('deep links', () => {
  it('open the page, scroll to the row and pulse it', async () => {
    await app(1220)
    act(() => useStore.getState().openSettings('downloads#saveLocation'))
    const row = document.querySelector('[data-row="saveLocation"]')
    expect(row?.classList.contains('ui-row-pulse')).toBe(true)
  })

  it.each(SEARCH_INDEX.map((e) => e.route))('%s lands on a page holding that row', async (route) => {
    await app(1220)
    act(() => useStore.getState().openSettings(route))
    const r = parseRoute(route)
    expect(formatRoute({ ...r, row: undefined })).toBe(route.split('#')[0])
    // Some rows wait on an IPC answer (the command-line tool's status).
    if (r.row) await waitFor(() => expect(document.querySelector(`[data-row="${r.row}"]`), route).not.toBeNull())
  })
})

describe('search', () => {
  it('finds rows by panel › subpage › row and deep-links to them', async () => {
    await app(1220)
    act(() => useStore.getState().openSettings())
    fireEvent.change(screen.getByRole('searchbox', { name: /find a setting/i }), { target: { value: 'proxy password' } })
    const hit = screen.getByRole('button', { name: /Network › Proxy/ })
    fireEvent.click(hit)
    expect(useStore.getState().settingsRoute).toBe('network/proxy#password')
  })
})

describe('Appearance', () => {
  it('offers the nine accents, and System only when the desktop reports one', async () => {
    await app(1220)
    act(() => useStore.getState().openSettings('appearance'))
    const group = screen.getByRole('radiogroup', { name: 'Accent Color' })
    expect(within(group).getAllByRole('radio')).toHaveLength(10)
    act(() => useStore.setState({ appInfo: { ...useStore.getState().appInfo!, systemAccent: undefined } }))
    expect(within(screen.getByRole('radiogroup', { name: 'Accent Color' })).getAllByRole('radio')).toHaveLength(9)
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    await waitFor(() => expect(useStore.getState().settings?.accent).toBe('blue'))
    expect(screen.getAllByRole('radio', { name: /Day|Night|System/ }).length).toBeGreaterThanOrEqual(3)
  })
})

describe('every page passes axe', () => {
  const routes = ['appearance', ...PANELS.slice(1).map((p) => p.id), ...Object.keys(SUBPAGES)]
  it.each(routes)('%s', async (route) => {
    await app(1220)
    act(() => useStore.getState().openSettings(route))
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('the proxy password (review nice-to-have)', () => {
  it('says so when the password could only be kept for this session', async () => {
    await app(1220)
    await act(async () => useStore.getState().saveSettings({ proxy: 'http://me@proxy.example:8080' }))
    const original = window.api.autoSetSecret
    window.api.autoSetSecret = async () => false
    act(() => useStore.getState().openSettings('network/proxy#password'))
    const field = (await screen.findByLabelText('proxy password', { exact: false })) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'hunter2' } })
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(await screen.findByText(/saved for this session only/)).toBeTruthy()
    window.api.autoSetSecret = original
  })
})
