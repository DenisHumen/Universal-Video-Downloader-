import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockApi } from '../lib/mockApi'
import { useStore } from '../store'
import { useI18n } from '../i18n'
import { TOOLTIP_DELAY } from '../ui'
import DownloadsView from './DownloadsView'
import QueueRow from '../components/QueueRow'
import type { DownloadItem } from '@shared/types'

/* The queue's scroller, its toolbar and what its buttons say, at both sides of 1000 px. */

const realMatchMedia = window.matchMedia
let width = 1200
const setWidth = (next: number): void => {
  width = next
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
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
  window.__uvdMock!.queue({ id: 'q1', title: 'Running', state: 'downloading', percent: 10 })
  window.__uvdMock!.queue({ id: 'q2', title: 'Failed', state: 'error', percent: 0, errorCode: 'signIn' })
  window.__uvdMock!.queue({ id: 'q3', title: 'Done', state: 'completed', percent: 100, finishedAt: Date.now(), filepath: '/v/q3.mp4' })
})
afterAll(() => {
  window.matchMedia = realMatchMedia
})
beforeEach(() => {
  useI18n.setState({ language: 'en' })
})

const queue = async (at: number): Promise<HTMLElement> => {
  setWidth(at)
  useStore.setState({ downloads: await window.api.listDownloads() })
  const { container } = render(
    <>
      <span id="uvd-header-end" />
      <DownloadsView />
    </>
  )
  return container
}

describe('the queue screen', () => {
  it('scrolls as a whole, so the toolbar and the rows share one column', async () => {
    const container = await queue(1200)
    const toolbar = container.querySelector<HTMLElement>('[data-uvd="queue-toolbar"]')!
    const list = container.querySelector('ul')!
    expect(toolbar.className).toContain('sticky')
    // Nothing between the column and the rows may scroll, or a scrollbar narrows them again.
    const column = toolbar.parentElement!
    expect(column.className).toContain('max-w-[800px]')
    expect(column.contains(list)).toBe(true)
    for (let el: HTMLElement | null = list; el && el !== column; el = el.parentElement) {
      expect(el.className).not.toContain('overflow')
    }
    expect(column.parentElement!.className).toContain('overflow-y-auto')
  })

  it('names what it does to many rows at once, in words', async () => {
    await queue(1200)
    expect(screen.getByRole('button', { name: 'Retry Failed' }).textContent).toContain('Retry Failed')
    expect(screen.getByRole('button', { name: 'Clear Failed' }).textContent).toContain('Clear Failed')
    expect(screen.getByRole('button', { name: 'Clear Finished' }).textContent).toContain('Clear Finished')
  })

  it('keeps its bulk actions short below 1000 px, each with a tooltip', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => {
        await queue(860)
      })
      const end = document.getElementById('uvd-header-end')!
      const pause = within(end).getByRole('button', { name: 'Pause All' })
      expect(pause.textContent).toBe('')
      // Failures keep their words; a bin says what it does on its own.
      expect(screen.getByRole('button', { name: 'Retry Failed' }).textContent).toContain('Retry Failed')
      const clear = screen.getByRole('button', { name: 'Clear Finished' })
      expect(clear.textContent).toBe('')
      fireEvent.mouseEnter(pause)
      act(() => vi.advanceTimersByTime(TOOLTIP_DELAY))
      expect(screen.getByRole('tooltip').textContent).toBe('Pause All')
    } finally {
      vi.useRealTimers()
    }
  })

  it('has no native tooltips on its buttons, which come late and never on focus', async () => {
    const container = await queue(1200)
    await waitFor(() => expect(container.querySelector('[data-row]')).not.toBeNull())
    expect(container.querySelectorAll('button[title]').length).toBe(0)
  })
})

describe('a queue row', () => {
  const running: DownloadItem = {
    id: 'r',
    kind: 'download',
    url: 'https://example.com/v',
    title: 'Running',
    state: 'downloading',
    percent: 62,
    outputDir: '/v',
    mode: 'video',
    createdAt: 1,
    targetHeight: 2160,
    speed: 8_400_000,
    eta: 94,
    downloadedBytes: 560_000_000,
    totalBytes: 900_000_000
  }

  it('says how much before how long, and the speed last: the end of the line is what a narrow row loses', () => {
    useI18n.setState({ language: 'en' })
    const { container } = render(
      <ul>
        <QueueRow item={running} index={0} />
      </ul>
    )
    const line = container.querySelector('p.numeric span.truncate')!.textContent!
    const size = line.indexOf('/')
    const eta = line.search(/left/i)
    const speed = line.search(/MB\/s/)
    expect(size).toBeGreaterThan(0)
    expect(eta).toBeGreaterThan(size)
    expect(speed).toBeGreaterThan(eta)
  })

  it('draws every action through the one icon button', () => {
    const { container } = render(
      <ul>
        <QueueRow item={running} index={0} />
      </ul>
    )
    const buttons = within(container).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(1)
    for (const b of buttons) {
      expect(b.className).toContain('ui-icon-btn')
      expect(b.getAttribute('title')).toBeNull()
    }
  })
})
