import { describe, expect, it } from 'vitest'
import { DEFAULT_BUTTON_LAYOUT, parseButtonLayout, parsePortalAccent, yaruAccent } from './desktop'

describe('parseButtonLayout (E6)', () => {
  it("reads Ubuntu's default and the gsettings quoting", () => {
    expect(parseButtonLayout("':minimize,maximize,close'\n")).toEqual({ start: [], end: ['minimize', 'maximize', 'close'] })
  })
  it('honours a left-side layout and ignores appmenu, spacer and unknowns', () => {
    expect(parseButtonLayout("'close,minimize:appmenu'")).toEqual({ start: ['close', 'minimize'], end: [] })
    expect(parseButtonLayout("'appmenu,spacer:close,frobnicate'")).toEqual({ start: [], end: ['close'] })
  })
  it('falls back to the default when unreadable or without a close button', () => {
    expect(parseButtonLayout('')).toEqual(DEFAULT_BUTTON_LAYOUT)
    expect(parseButtonLayout('nonsense')).toEqual(DEFAULT_BUTTON_LAYOUT)
    expect(parseButtonLayout("':minimize'")).toEqual(DEFAULT_BUTTON_LAYOUT)
  })
})

describe('parsePortalAccent (E2)', () => {
  it('reads the portal tuple', () => {
    expect(parsePortalAccent('(<(0.207, 0.518, 0.894)>,)')).toBe('3584e4')
  })
  it('refuses anything else', () => {
    for (const bad of ['', 'Error: NotFound', '(<(1.2, 0, 0)>,)', '(<(0.1, 0.2)>,)', '(<uint32 1>,)']) {
      expect(parsePortalAccent(bad)).toBeNull()
    }
  })
})

describe('yaruAccent', () => {
  it("maps Ubuntu's Yaru variants, dark or not", () => {
    expect(yaruAccent("'Yaru-dark'")).toBe('e95420')
    expect(yaruAccent('Yaru')).toBe('e95420')
    expect(yaruAccent('Yaru-blue-dark')).toBe('0073e5')
    expect(yaruAccent('Yaru-prussiangreen')).toBe('308280')
    expect(yaruAccent('Adwaita')).toBeNull()
    expect(yaruAccent('Yaru-neon')).toBeNull()
  })
})
