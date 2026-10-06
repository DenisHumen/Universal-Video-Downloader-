import { describe, expect, it } from 'vitest'
import { PROBE_SCRIPT } from './sniffer'

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
