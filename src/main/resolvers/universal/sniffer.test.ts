import { describe, expect, it } from 'vitest'
import { navigationLedger, PROBE_SCRIPT, withoutFailedPages } from './sniffer'
import type { MediaCandidate } from './candidates'

const candidate = (url: string): MediaCandidate => ({ url, kind: 'file', score: 82, source: 'network' })

describe('withoutFailedPages', () => {
  it('does not offer the address the window could not open', () => {
    const failed = new Set(['https://site.test/gone.mp4'])
    expect(withoutFailedPages([candidate('https://site.test/gone.mp4')], failed)).toEqual([])
  })

  it('keeps what a page behind a refusal still played', () => {
    const failed = new Set(['https://site.test/watch/1'])
    const real = candidate('https://cdn.test/real.mp4')
    expect(withoutFailedPages([real], failed)).toEqual([real])
  })
})

describe('navigationLedger', () => {
  it('calls a page that refused dead', () => {
    const failed = new Set<string>()
    navigationLedger(failed).answered('https://site.test/a.mp4', 403)
    expect(failed.has('https://site.test/a.mp4')).toBe(true)
  })

  it('takes it back when a challenge page reloads and answers 200', () => {
    const failed = new Set<string>()
    const ledger = navigationLedger(failed)
    ledger.started('https://site.test/a.mp4')
    ledger.answered('https://site.test/a.mp4', 403)
    ledger.started('https://site.test/a.mp4')
    ledger.answered('https://site.test/a.mp4', 200)
    expect(failed.size).toBe(0)
  })

  it('drops a whole redirect chain that ends in a failure', () => {
    const failed = new Set<string>()
    const ledger = navigationLedger(failed)
    ledger.started('https://site.test/old.mp4')
    ledger.redirected('https://site.test/moved.mp4')
    ledger.redirected('https://site.test/dead.mp4')
    ledger.answered('https://site.test/dead.mp4', 404)
    expect([...failed].sort()).toEqual(['https://site.test/dead.mp4', 'https://site.test/moved.mp4', 'https://site.test/old.mp4'])
  })

  it('counts one that never answered', () => {
    const failed = new Set<string>()
    const ledger = navigationLedger(failed)
    ledger.started('https://site.test/old.mp4')
    ledger.redirected('https://gone.test/x.mp4')
    ledger.didNotLoad('https://gone.test/x.mp4')
    expect(failed.has('https://site.test/old.mp4')).toBe(true)
  })

  it('leaves a chain that arrived alone', () => {
    const failed = new Set<string>()
    const ledger = navigationLedger(failed)
    ledger.started('https://site.test/old.mp4')
    ledger.redirected('https://site.test/new.mp4')
    ledger.answered('https://site.test/new.mp4', 200)
    expect(failed.size).toBe(0)
  })

  it('does not blame a new navigation for the one before it', () => {
    const failed = new Set<string>()
    const ledger = navigationLedger(failed)
    ledger.started('https://site.test/first')
    ledger.answered('https://site.test/first', 200)
    ledger.started('https://site.test/second')
    ledger.answered('https://site.test/second', 500)
    expect([...failed]).toEqual(['https://site.test/second'])
  })
})

/*
  The script the hidden browser runs in each page is written as a template
  literal, which spends every backslash before the page sees it. One regex in it
  arrived as `/^(https?:|//)/`, a SyntaxError, and from v3.9.0 the script failed
  to parse on every page: nothing was started, no play button pressed, nothing
  read off the DOM. The only failure was a line in a console nobody watches.
*/
describe('PROBE_SCRIPT', () => {
  it('parses as JavaScript once the template literal has had its way', () => {
    expect(() => new Function(`return ${PROBE_SCRIPT}`)).not.toThrow()
  })

  it('carries no backslash, which is the way that broke it', () => {
    expect(PROBE_SCRIPT).not.toContain('\\')
  })

  it("presses Kodik's play button, which is an anchor with no address", () => {
    expect(PROBE_SCRIPT).toContain("'.play_button'")
    expect(PROBE_SCRIPT).not.toContain("el.tagName === 'A'")
  })
})
