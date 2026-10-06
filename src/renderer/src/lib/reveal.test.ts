import { describe, expect, it } from 'vitest'
import { revealScroll } from './reveal'

describe('revealScroll', () => {
  const view = { scrollLeft: 100, width: 400 }

  it('leaves an item that is already in view alone', () => {
    expect(revealScroll(view, { left: 150, width: 100 })).toBe(100)
    expect(revealScroll(view, { left: 100, width: 400 })).toBe(100)
  })

  // The settings tab, half behind the right-hand arrow.
  it('scrolls just far enough to bring a clipped item in on the right', () => {
    expect(revealScroll(view, { left: 450, width: 100 })).toBe(150)
  })

  it('scrolls back to an item clipped on the left', () => {
    expect(revealScroll(view, { left: 60, width: 100 })).toBe(60)
  })

  it('aligns an item wider than the view to its start', () => {
    expect(revealScroll(view, { left: 300, width: 600 })).toBe(300)
  })
})
