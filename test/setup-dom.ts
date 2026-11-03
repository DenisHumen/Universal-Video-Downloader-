/*
  Runs before every test file. Node-environment tests skip it all (no window);
  jsdom ones get the browser APIs the renderer touches that jsdom lacks, and a
  cleanup between tests.
*/
import { afterEach } from 'vitest'

if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())

  const w = window as unknown as Record<string, unknown>
  w.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })
  class Noop {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return []
    }
  }
  w.ResizeObserver ??= Noop
  w.IntersectionObserver ??= Noop
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as typeof Element.prototype.scrollTo
  window.scrollTo = () => undefined
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
}
