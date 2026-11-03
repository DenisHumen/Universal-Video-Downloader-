import { describe, expect, it } from 'vitest'
import { SHORTCUT_ROWS } from '../lib/shortcuts'
import { en } from '../i18n/en'
import { ru } from '../i18n/ru'
import { NAV_ALL, NAV_BOTTOM, NAV_MAIN } from './nav'

describe('4.0 sections', () => {
  it('are Download, Search, Activity, Watching, with Settings at the bottom', () => {
    // Sentence case: the 4.0 copy voice reaches the shell first ([v3] VD note).
    expect(NAV_MAIN.map((s) => en[s.label])).toEqual(['Download', 'Search', 'Activity', 'Library', 'Watching'])
    expect(NAV_BOTTOM.map((s) => en[s.label])).toEqual(['Settings'])
    expect(NAV_ALL.map((s) => ru[s.label])).toEqual(['Скачать', 'Поиск', 'Активность', 'Библиотека', 'Слежение', 'Настройки'])
  })

  it('name every section in Russian too', () => {
    for (const s of NAV_ALL) expect(ru[s.label]).toBeTruthy()
  })

  it('keep a Ctrl/⌘ digit per section that the shortcut table agrees with', () => {
    for (const s of NAV_ALL) {
      const shortcut = SHORTCUT_ROWS.find((k) => k.action === s.id)
      expect(shortcut?.keys[0]).toEqual(['mod', s.key])
    }
  })
})
