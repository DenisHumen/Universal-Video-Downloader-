import { describe, expect, it } from 'vitest'
import { applyAccent, applyTheme } from './theme'

describe('applyAccent', () => {
  const root = document.documentElement

  it('sets the chosen accent as an attribute', () => {
    applyAccent('violet')
    expect(root.getAttribute('data-accent')).toBe('violet')
    applyAccent(undefined)
    expect(root.getAttribute('data-accent')).toBe('blue')
  })

  it('falls back to Blue when the OS reports no accent', () => {
    applyAccent('system', undefined)
    expect(root.getAttribute('data-accent')).toBe('blue')
    expect(root.style.getPropertyValue('--accent')).toBe('')
  })

  it('sets a clamped OS accent inline, and clears it when the choice changes', () => {
    root.style.setProperty('--bg', '10 10 13')
    root.style.setProperty('--surface', '20 20 24')
    root.setAttribute('data-theme', 'night')
    applyAccent('system', '0078d4')
    expect(root.style.getPropertyValue('--accent')).toMatch(/^\d+ \d+ \d+$/)
    applyAccent('teal')
    expect(root.style.getPropertyValue('--accent')).toBe('')
  })
})

describe('applyTheme', () => {
  const root = document.documentElement

  it('paints Night and Day as chosen', () => {
    applyTheme('day')
    expect(root.getAttribute('data-theme')).toBe('day')
    applyTheme('night')
    expect(root.getAttribute('data-theme')).toBe('night')
  })

  it('follows the OS on System, live, and stops when another theme is chosen', () => {
    let dark = true
    let listener: (() => void) | null = null
    const real = window.matchMedia
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query.includes('dark') && dark
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => (listener = cb),
      removeEventListener: () => (listener = null)
    })) as unknown as typeof window.matchMedia
    try {
      applyTheme('system')
      expect(root.getAttribute('data-theme')).toBe('night')
      dark = false
      listener?.()
      expect(root.getAttribute('data-theme')).toBe('day')
      applyTheme('night')
      expect(listener).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })
})
