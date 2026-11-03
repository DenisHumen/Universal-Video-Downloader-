import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron 44's clipboard: readText() answers with a promise.
const board = vi.hoisted(() => ({ text: '', fail: false }))
vi.mock('electron', () => ({
  clipboard: {
    readText: async (): Promise<string> => {
      if (board.fail) throw new Error('no clipboard')
      return board.text
    }
  }
}))

import { readClipboardText, startClipboardWatch, stopClipboardWatch } from './clipboard'

describe('the clipboard watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    board.text = ''
    board.fail = false
  })
  afterEach(() => {
    stopClipboardWatch()
    vi.useRealTimers()
  })

  it('reads the text trimmed, and empty when it cannot be read', async () => {
    board.text = '  https://example.com/v  \n'
    expect(await readClipboardText()).toBe('https://example.com/v')
    board.fail = true
    expect(await readClipboardText()).toBe('')
  })

  it('does not offer what was already on the clipboard when it started', async () => {
    board.text = 'https://example.com/already'
    const offered: string[] = []
    startClipboardWatch((url) => offered.push(url))
    await vi.advanceTimersByTimeAsync(5000)
    expect(offered).toEqual([])
  })

  it('offers a link copied afterwards, once', async () => {
    const offered: string[] = []
    startClipboardWatch((url) => offered.push(url))
    await vi.advanceTimersByTimeAsync(0)
    board.text = 'https://example.com/new'
    await vi.advanceTimersByTimeAsync(5000)
    expect(offered).toEqual(['https://example.com/new'])
  })

  it('offers nothing after it is stopped', async () => {
    const offered: string[] = []
    startClipboardWatch((url) => offered.push(url))
    await vi.advanceTimersByTimeAsync(0)
    stopClipboardWatch()
    board.text = 'https://example.com/late'
    await vi.advanceTimersByTimeAsync(5000)
    expect(offered).toEqual([])
  })
})
