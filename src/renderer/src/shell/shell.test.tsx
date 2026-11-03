import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ButtonLayout } from '@shared/desktop'
import { axeViolations } from '../../../../test/axe'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import Shell from './Shell'
import { SIDEBAR_PINNED_FROM } from './layout'

/*
  D5 (A1.1 + A1.2 E6, and the 4.2 SE-1 veto): the shell keeps the window
  usable on every OS. The platform and GNOME's button order arrive through
  the preload (appInfo in the store) and the shell's prop, never
  process.platform, so jsdom renders it as each OS.
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

beforeAll(() => installMockApi())
beforeEach(() => useStore.setState({ view: 'home', sidebarOverlayOpen: false, sidebarFolded: false }))
afterEach(() => {
  window.matchMedia = realMatchMedia
})

async function shell(
  platform: NodeJS.Platform,
  width = 1220,
  buttonLayout: ButtonLayout = { start: [], end: ['minimize', 'maximize', 'close'] }
): Promise<HTMLElement> {
  viewport(width)
  const info = { ...(useStore.getState().appInfo ?? {}), platform, buttonLayout } as never
  useStore.setState({ appInfo: info })
  const { container } = render(
    <Shell platform={platform}>
      <main>content</main>
    </Shell>
  )
  await act(async () => undefined)
  return container
}

describe('on linux', () => {
  it("draws GNOME's round caption buttons at the end, in button-layout order, no-drag, in a drag region", async () => {
    const root = await shell('linux')
    const strip = root.querySelector<HTMLElement>('[data-uvd="sheet-drag"]')!
    expect(strip.classList.contains('drag-region')).toBe(true)
    const buttons = within(strip.querySelector<HTMLElement>('[data-uvd="caption-end"]')!).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Minimize', 'Maximize', 'Close'])
    for (const b of buttons) expect(b.className).toContain('no-drag')
  })

  it('honours a left-side layout: the buttons go to the left-most header shown', async () => {
    const root = await shell('linux', 1220, { start: ['close', 'minimize'], end: [] })
    const side = root.querySelector<HTMLElement>('[data-uvd="sidebar-drag"]')!
    expect(within(side).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining(['Close', 'Minimize'])
    )
    expect(root.querySelector('[data-uvd="caption-end"]')).toBeNull()
  })
})

describe('on win32', () => {
  it("keeps the corner free for Windows' own caption overlay and draws no buttons of its own", async () => {
    const root = await shell('win32')
    expect(root.querySelector('[data-uvd="sheet-drag"] [data-uvd="caption-overlay"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})

describe('on darwin', () => {
  it('leaves the caption to the traffic lights, whose space is reserved in the sidebar header', async () => {
    const root = await shell('darwin')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(root.querySelector('[data-uvd="sidebar-drag"]')?.classList.contains('drag-region')).toBe(true)
  })
})

describe('the drag regions', () => {
  it.each(['win32', 'linux', 'darwin'] as const)('exist on %s, with every control no-drag', async (platform) => {
    const root = await shell(platform)
    for (const id of ['sheet-drag', 'sidebar-drag']) {
      const bar = root.querySelector<HTMLElement>(`[data-uvd="${id}"]`)!
      expect(bar.classList.contains('drag-region')).toBe(true)
      for (const b of within(bar).queryAllByRole('button')) expect(b.className).toMatch(/no-drag|ui-icon-btn|ui-caption/)
    }
    const nav = screen.getByRole('navigation')
    for (const b of within(nav).getAllByRole('button')) expect(b.className).toContain('no-drag')
  })
})

describe('sidebar', () => {
  it(`is pinned from ${SIDEBAR_PINNED_FROM}px, with the section title in the content header`, async () => {
    await shell('linux', SIDEBAR_PINNED_FROM)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('button', { name: /download/i }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: 'Download' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sidebar' })).toBeNull()
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('is an overlay below that, opened from the toggle and closed by Esc - never an icon rail', async () => {
    await shell('linux', SIDEBAR_PINNED_FROM - 1)
    expect(screen.queryByRole('navigation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }))
    expect(screen.getByRole('navigation')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('switches views, marks the current one, and closes the overlay', async () => {
    await shell('linux', 700)
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }))
    act(() => within(screen.getByRole('navigation')).getByRole('button', { name: /activity/i }).click())
    expect(useStore.getState().view).toBe('downloads')
    expect(useStore.getState().sidebarOverlayOpen).toBe(false)
  })

  it('is folded by Settings at medium widths, so there is never a double rail', async () => {
    useStore.setState({ sidebarFolded: true })
    await shell('linux', 1000)
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
