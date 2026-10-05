import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOASTS, RESUME_MIN_MS, TOAST_MS, toast, useToasts } from './toast'

const shown = (): string[] => useToasts.getState().toasts.map((t) => t.message)
const idOf = (message: string): number => useToasts.getState().toasts.find((t) => t.message === message)!.id

/*
  Every toast used to disappear after a fixed 3.4 s, with no way to hold it
  and no way to close it - and a two-line share error is gone before it can be
  read, when for some actions it is the only place the failure is reported.
*/
describe('toast timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    const { toasts, dismiss } = useToasts.getState()
    for (const t of toasts) dismiss(t.id)
    vi.useRealTimers()
  })

  it('keeps an error on screen far longer than a confirmation', () => {
    toast('copied', 'success')
    toast('There is no share by that name on the server.', 'error')
    vi.advanceTimersByTime(TOAST_MS.success + 1)
    expect(shown()).toEqual(['There is no share by that name on the server.'])
    vi.advanceTimersByTime(TOAST_MS.error - TOAST_MS.success)
    expect(shown()).toEqual([])
    expect(TOAST_MS.error).toBeGreaterThanOrEqual(8000)
  })

  it('does not expire while paused', () => {
    toast('a long failure', 'error')
    useToasts.getState().pause(idOf('a long failure'))
    vi.advanceTimersByTime(TOAST_MS.error * 5)
    expect(shown()).toEqual(['a long failure'])
  })

  it('resumes with the time that was left', () => {
    toast('a long failure', 'error')
    const id = idOf('a long failure')
    vi.advanceTimersByTime(3000)
    useToasts.getState().pause(id)
    vi.advanceTimersByTime(60_000)
    useToasts.getState().resume(id)
    vi.advanceTimersByTime(TOAST_MS.error - 3000 - 1)
    expect(shown()).toEqual(['a long failure'])
    vi.advanceTimersByTime(1)
    expect(shown()).toEqual([])
  })

  it('leaves time to look again when the pointer leaves just before it would have gone', () => {
    toast('copied', 'success')
    const id = idOf('copied')
    vi.advanceTimersByTime(TOAST_MS.success - 10)
    useToasts.getState().pause(id)
    useToasts.getState().resume(id)
    vi.advanceTimersByTime(RESUME_MIN_MS - 1)
    expect(shown()).toEqual(['copied'])
    vi.advanceTimersByTime(1)
    expect(shown()).toEqual([])
  })

  it('a second resume does not start a second countdown', () => {
    toast('a long failure', 'error')
    const id = idOf('a long failure')
    useToasts.getState().pause(id)
    useToasts.getState().resume(id)
    useToasts.getState().resume(id)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('dismiss removes the toast and its timer', () => {
    toast('a long failure', 'error')
    useToasts.getState().dismiss(idOf('a long failure'))
    expect(shown()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps only the newest few, so repeated failures do not bury the controls', () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i++) toast(`failure ${i}`, 'error')
    expect(shown()).toEqual(['failure 3', 'failure 4', 'failure 5'])
    expect(vi.getTimerCount()).toBe(MAX_TOASTS)
  })
})
