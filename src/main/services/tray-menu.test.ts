import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import { closeHidesWindow, trayStatusLine, type TrayStatusKey } from './tray-menu'

const EN: Record<TrayStatusKey, string> = {
  'tray.statusDownloading': '{count} downloading · {percent}%',
  'tray.statusDownloadingNoPercent': '{count} downloading',
  'tray.statusQueued': '{count} queued',
  'tray.statusPaused': '{count} paused',
  'tray.statusIdle': 'No active downloads'
}
const t = (key: TrayStatusKey): string => EN[key]

const row = (state: DownloadItem['state'], percent = 0, indeterminate?: boolean) => ({
  state,
  percent,
  indeterminate
})

describe('trayStatusLine', () => {
  it('counts what is running and averages its progress', () => {
    expect(trayStatusLine([row('downloading', 30), row('processing', 60), row('queued')], t)).toBe(
      '2 downloading · 45%'
    )
  })

  it('rounds and clamps the figure', () => {
    expect(trayStatusLine([row('downloading', 33.4), row('downloading', 140)], t)).toBe('2 downloading · 67%')
  })

  it('leaves out a figure no running item has, and ignores those in the average', () => {
    expect(trayStatusLine([row('downloading', 0, true)], t)).toBe('1 downloading')
    expect(trayStatusLine([row('downloading', 0, true), row('downloading', 50)], t)).toBe('2 downloading · 50%')
  })

  it('falls back to waiting, then paused, then idle', () => {
    expect(trayStatusLine([row('queued'), row('detecting'), row('paused', 10)], t)).toBe('2 queued')
    expect(trayStatusLine([row('paused', 10), row('completed', 100)], t)).toBe('1 paused')
    expect(trayStatusLine([row('completed', 100), row('error')], t)).toBe('No active downloads')
    expect(trayStatusLine([], t)).toBe('No active downloads')
  })
})

describe('closeHidesWindow', () => {
  const off = { trayEnabled: false, automationEnabled: false }
  const tray = { trayEnabled: true, automationEnabled: false }
  const watching = { trayEnabled: false, automationEnabled: true }

  it('closes the window by default', () => {
    expect(closeHidesWindow({ quitting: false, hasTray: false, settings: off })).toBe(false)
  })

  it('hides it while the tray keeps the app running', () => {
    expect(closeHidesWindow({ quitting: false, hasTray: true, settings: tray })).toBe(true)
    expect(closeHidesWindow({ quitting: false, hasTray: true, settings: watching })).toBe(true)
  })

  it('closes for real once a quit is under way', () => {
    expect(closeHidesWindow({ quitting: true, hasTray: true, settings: tray })).toBe(false)
  })

  it('never hides a window there is no tray icon to bring back', () => {
    expect(closeHidesWindow({ quitting: false, hasTray: false, settings: tray })).toBe(false)
  })
})
