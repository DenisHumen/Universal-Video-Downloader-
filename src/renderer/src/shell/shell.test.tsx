import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import Shell, { RAIL_BELOW } from './Shell'

/*
  Plan 4.2 [v2] SE-1: the 4.0 shell must keep the window usable on every OS.
  The platform reaches the shell as a prop ([v3] SE-a), so jsdom renders it as
  each one.
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
afterEach(() => {
  window.matchMedia = realMatchMedia
})

async function shell(platform: NodeJS.Platform, width = 1220): Promise<HTMLElement> {
  viewport(width)
  const { container } = render(
    <Shell platform={platform}>
      <main>content</main>
    </Shell>
  )
  await act(async () => undefined)
  return container
}

describe.each(['win32', 'linux'] as const)('on %s', (platform) => {
  it('draws minimise, maximise and close, inside a drag region, as no-drag buttons', async () => {
    const root = await shell(platform)
    const strip = root.querySelector('[data-uvd="sheet-drag"]')!
    expect(strip.classList.contains('drag-region')).toBe(true)
    for (const name of ['minimize', 'maximize', 'close']) {
      const button = within(strip as HTMLElement).getByRole('button', { name: new RegExp(name, 'i') })
      expect(button.className).toContain('no-drag')
    }
  })
})

describe('on darwin', () => {
  it('leaves the caption to the traffic lights, which sit in the sidebar top', async () => {
    const root = await shell('darwin')
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    const top = root.querySelector('[data-uvd="sidebar-drag"]')!
    expect(top.classList.contains('drag-region')).toBe(true)
    // Reserved, not drawn over: nothing interactive or branded sits under the lights.
    expect(top.children).toHaveLength(0)
  })
})

describe('the drag regions', () => {
  it.each(['win32', 'linux', 'darwin'] as const)('exist on %s, with every nav control no-drag', async (platform) => {
    const root = await shell(platform)
    expect(root.querySelector('[data-uvd="sheet-drag"].drag-region')).not.toBeNull()
    expect(root.querySelector('[data-uvd="sidebar-drag"].drag-region')).not.toBeNull()
    const nav = screen.getByRole('navigation')
    for (const b of within(nav).getAllByRole('button')) expect(b.className).toContain('no-drag')
  })
})

describe('sidebar', () => {
  it(`is a labelled list of sections at ${RAIL_BELOW}px and up`, async () => {
    await shell('win32', RAIL_BELOW)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('button', { name: /activity/i })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: /download/i }).getAttribute('aria-current')).toBe('page')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('collapses to an icon rail below that, every item still named', async () => {
    const root = await shell('linux', RAIL_BELOW - 1)
    expect(root.querySelector('[data-rail]')).not.toBeNull()
    const nav = screen.getByRole('navigation')
    const names = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
    expect(names.every(Boolean)).toBe(true)
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('switches views and marks the current one', async () => {
    await shell('win32')
    const nav = screen.getByRole('navigation')
    act(() => within(nav).getByRole('button', { name: /settings/i }).click())
    expect(useStore.getState().view).toBe('settings')
    expect(within(nav).getByRole('button', { name: /settings/i }).getAttribute('aria-current')).toBe('page')
  })
})
