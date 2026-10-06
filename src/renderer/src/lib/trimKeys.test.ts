import { describe, expect, it } from 'vitest'
import { trimKeyTarget } from './trimKeys'

// A two-hour stream with the middle hour chosen.
const span = { start: 1800, end: 5400, total: 7200 }

describe('trimKeyTarget', () => {
  it('steps by a second, or five with Shift', () => {
    expect(trimKeyTarget('ArrowRight', false, 'start', span)).toBe(1801)
    expect(trimKeyTarget('ArrowLeft', true, 'end', span)).toBe(5395)
  })

  it('treats Up and Down as Right and Left', () => {
    expect(trimKeyTarget('ArrowUp', false, 'end', span)).toBe(5401)
    expect(trimKeyTarget('ArrowDown', false, 'start', span)).toBe(1799)
  })

  it('pages by a twentieth of the video', () => {
    expect(trimKeyTarget('PageUp', false, 'start', span)).toBe(2160)
    expect(trimKeyTarget('PageDown', false, 'end', span)).toBe(5040)
  })

  it('pages by at least ten seconds on a short clip', () => {
    expect(trimKeyTarget('PageUp', false, 'start', { start: 0, end: 60, total: 60 })).toBe(10)
  })

  it('sends Home and End to the ends of the timeline', () => {
    expect(trimKeyTarget('Home', false, 'start', span)).toBe(0)
    expect(trimKeyTarget('End', false, 'end', span)).toBe(7200)
  })

  // The handles never cross, the same rule dragging follows.
  it('stops the start handle just short of the end', () => {
    expect(trimKeyTarget('End', false, 'start', span)).toBe(5399.9)
    expect(trimKeyTarget('PageUp', false, 'start', { start: 5390, end: 5400, total: 7200 })).toBe(5399.9)
  })

  it('stops the end handle just past the start', () => {
    expect(trimKeyTarget('Home', false, 'end', span)).toBe(1800.1)
    expect(trimKeyTarget('ArrowLeft', true, 'end', { start: 100, end: 102, total: 7200 })).toBe(100.1)
  })

  it('keeps both handles on the timeline', () => {
    expect(trimKeyTarget('ArrowLeft', false, 'start', { start: 0, end: 60, total: 60 })).toBe(0)
    expect(trimKeyTarget('ArrowRight', false, 'end', { start: 0, end: 60, total: 60 })).toBe(60)
  })

  it('leaves every other key to the page', () => {
    expect(trimKeyTarget('Enter', false, 'start', span)).toBeNull()
    expect(trimKeyTarget('Tab', false, 'end', span)).toBeNull()
  })
})
