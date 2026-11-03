import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  E3a: under Electron 45 on GNOME the colour scheme arrives ~70 ms after
  whenReady. Start-up waits for it (capped), and every later change is
  re-applied to the windows.
*/

const h = vi.hoisted(() => ({ dark: false }))
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('events')
  const nativeTheme = new Emitter()
  Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { get: () => h.dark })
  return { nativeTheme }
})

import { THEME_SETTLE_MS, followNativeTheme, settleNativeTheme, themeOptions } from './window-chrome'
import { WINDOW_BACKGROUND } from '@shared/theme-boot'

beforeEach(() => {
  vi.useFakeTimers()
  h.dark = false
})
afterEach(() => vi.useRealTimers())

describe('settleNativeTheme', () => {
  it('waits on Linux for the first update, then the theme is the real one', async () => {
    const source = new EventEmitter()
    let settled = false
    void settleNativeTheme(source, 'linux').then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(70)
    expect(settled).toBe(false)
    // At whenReady this would have been Day on a dark desktop.
    expect(themeOptions('system').backgroundColor).toBe(WINDOW_BACKGROUND.day)
    h.dark = true
    source.emit('updated')
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(themeOptions('system').backgroundColor).toBe(WINDOW_BACKGROUND.night)
    expect(themeOptions('system').additionalArguments).toEqual(['--uvd-theme=night'])
    expect(source.listenerCount('updated')).toBe(0)
  })

  it('gives up after the cap when no update ever comes', async () => {
    const source = new EventEmitter()
    let settled = false
    void settleNativeTheme(source, 'linux').then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(THEME_SETTLE_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(source.listenerCount('updated')).toBe(0)
  })

  it.each(['win32', 'darwin'] as const)('does not wait on %s', async (platform) => {
    let settled = false
    void settleNativeTheme(new EventEmitter(), platform).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })
})

describe('followNativeTheme', () => {
  it('repaints every live window and tells its renderer', () => {
    const win = () => ({ isDestroyed: () => false, setBackgroundColor: vi.fn(), webContents: { send: vi.fn() } })
    const a = win()
    const gone = { ...win(), isDestroyed: () => true }
    h.dark = true
    followNativeTheme(() => [a, gone] as never, () => 'system')
    expect(a.setBackgroundColor).toHaveBeenCalledWith(WINDOW_BACKGROUND.night)
    expect(a.webContents.send).toHaveBeenCalledWith('event:native-theme')
    expect(gone.setBackgroundColor).not.toHaveBeenCalled()
  })

  it('leaves an explicit theme alone whatever the OS says', () => {
    const a = { isDestroyed: () => false, setBackgroundColor: vi.fn(), webContents: { send: vi.fn() } }
    h.dark = true
    followNativeTheme(() => [a] as never, () => 'day')
    expect(a.setBackgroundColor).toHaveBeenCalledWith(WINDOW_BACKGROUND.day)
  })
})
