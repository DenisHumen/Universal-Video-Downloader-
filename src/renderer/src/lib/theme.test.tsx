import { describe, expect, it } from 'vitest'
import { applyAccent } from './theme'

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
