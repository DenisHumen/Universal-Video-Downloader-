import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  Electron 44's clipboard: readText() answers with a promise. `delay` holds
  each answer back that long (Infinity: never answers); `active` and `most`
  count reads that are out at the same time.
*/
const board = vi.hoisted(() => ({
  text: '',
  fail: false,
  delay: 0,
  active: 0,
  most: 0,
  calls: 0
}))
vi.mock('electron', () => ({
  clipboard: {
    readText: (): Promise<string> => {
      board.calls++
      board.active++
      board.most = Math.max(board.most, board.active)
      const text = board.text
      const fail = board.fail
      const delay = board.delay
      return new Promise<string>((resolve, reject) => {
        const answer = (): void => {
          board.active--
          if (fail) reject(new Error('no clipboard'))
          else resolve(text)
        }
        if (delay === Infinity) return
        if (delay === 0) queueMicrotask(answer)
        else setTimeout(answer, delay)
      })
    }
  }
}))

import {
  READ_TIMEOUT_MS,
  readClipboardText,
  startClipboardWatch,
  stopClipboardWatch
} from './clipboard'

describe('the clipboard watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(board, { text: '', fail: false, delay: 0, active: 0, most: 0, calls: 0 })
  })
  afterEach(async () => {
    stopClipboardWatch()
    // Let any read still out run into its timeout, so the next test starts clean.
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 2)
    vi.useRealTimers()
  })

  it('reads the text trimmed, and empty when it cannot be read', async () => {
    board.text = '  https://example.com/v  \n'
    expect(await readClipboardText()).toBe('https://example.com/v')
    board.fail = true
    expect(await readClipboardText()).toBe('')
  })

  it('counts a read that never answers as empty', async () => {
    board.text = 'https://example.com/v'
    board.delay = Infinity
    const read = readClipboardText()
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    expect(await read).toBe('')
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

  it('keeps watching after a read that hung, across a stop and start', async () => {
    const offered: string[] = []
    startClipboardWatch((url) => offered.push(url))
    await vi.advanceTimersByTimeAsync(0)
    // The clipboard stops answering mid-watch...
    board.delay = Infinity
    await vi.advanceTimersByTimeAsync(1200)
    stopClipboardWatch()
    startClipboardWatch((url) => offered.push(url))
    // ...and answers again.
    board.delay = 0
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1200)
    board.text = 'https://example.com/after-hang'
    await vi.advanceTimersByTimeAsync(5000)
    expect(offered).toEqual(['https://example.com/after-hang'])
  })

  it('never has two reads out when restarted with one in flight', async () => {
    const offered: string[] = []
    board.delay = 1000
    startClipboardWatch((url) => offered.push(url))
    await vi.advanceTimersByTimeAsync(1100)
    // A tick's read is out now; restart under it, several times.
    await vi.advanceTimersByTimeAsync(150)
    expect(board.active).toBe(1)
    for (let i = 0; i < 3; i++) {
      stopClipboardWatch()
      startClipboardWatch((url) => offered.push(url))
    }
    board.text = 'https://example.com/restarted'
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.most).toBe(1)
    expect(offered).toEqual(['https://example.com/restarted'])
  })
})
