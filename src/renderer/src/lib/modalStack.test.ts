import { afterEach, describe, expect, it } from 'vitest'
import {
  claimsEscape,
  openModals,
  pushModal,
  removeModal,
  topModal,
  trapTarget,
  type ModalEntry
} from './modalStack'

const entry = (): ModalEntry => ({ close: () => undefined })

describe('the dialog stack', () => {
  const opened: ModalEntry[] = []
  const open = (): ModalEntry => {
    const e = entry()
    opened.push(e)
    pushModal(e)
    return e
  }
  afterEach(() => {
    for (const e of opened.splice(0)) removeModal(e)
  })

  it('hands keys to the dialog opened last', () => {
    open()
    const editor = open()
    expect(topModal()).toBe(editor)
    const confirm = open()
    expect(topModal()).toBe(confirm)
  })

  // The confirmation over the step editor closes; the editor gets Esc back.
  it('gives the keys back when the top dialog closes', () => {
    const editor = open()
    const confirm = open()
    removeModal(confirm)
    expect(topModal()).toBe(editor)
    removeModal(editor)
    expect(topModal()).toBeUndefined()
    expect(openModals()).toBe(0)
  })

  it('lets a dialog underneath close without disturbing the top one', () => {
    const editor = open()
    const confirm = open()
    removeModal(editor)
    expect(topModal()).toBe(confirm)
    expect(openModals()).toBe(1)
  })

  // StrictMode mounts effects twice; the dialog must still be listed once.
  it('lists a dialog once however often it registers', () => {
    const e = open()
    pushModal(e)
    expect(openModals()).toBe(1)
    removeModal(e)
    removeModal(e)
    expect(openModals()).toBe(0)
  })
})

describe('claimsEscape', () => {
  const key = (over: Partial<{ key: string; defaultPrevented: boolean; isComposing: boolean }>) => ({
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    ...over
  })

  it('answers a plain Esc', () => {
    expect(claimsEscape(key({}))).toBe(true)
  })

  it('leaves an Esc something earlier already spent', () => {
    expect(claimsEscape(key({ defaultPrevented: true }))).toBe(false)
  })

  it('leaves Esc to an input method mid-composition', () => {
    expect(claimsEscape(key({ isComposing: true }))).toBe(false)
  })

  it('ignores every other key', () => {
    expect(claimsEscape(key({ key: 'Enter' }))).toBe(false)
  })
})

describe('trapTarget', () => {
  it('wraps from the last control to the first', () => {
    expect(trapTarget(3, 2, false)).toBe(0)
  })

  it('wraps from the first control back to the last', () => {
    expect(trapTarget(3, 0, true)).toBe(2)
  })

  it('leaves the browser alone between the ends', () => {
    expect(trapTarget(3, 1, false)).toBeNull()
    expect(trapTarget(3, 1, true)).toBeNull()
    expect(trapTarget(3, 0, false)).toBeNull()
    expect(trapTarget(3, 2, true)).toBeNull()
  })

  // Focus on the panel, or on the page behind it after a click on the backdrop.
  it('pulls focus back in from outside the controls', () => {
    expect(trapTarget(3, -1, false)).toBe(0)
    expect(trapTarget(3, -1, true)).toBe(2)
  })

  it('keeps a single control focused both ways', () => {
    expect(trapTarget(1, 0, false)).toBe(0)
    expect(trapTarget(1, 0, true)).toBe(0)
  })

  it('has nowhere to go without controls', () => {
    expect(trapTarget(0, -1, false)).toBeNull()
  })
})
