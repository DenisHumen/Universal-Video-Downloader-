import { describe, expect, it } from 'vitest'
import { autostartNeedsApplying } from './autostart'

/*
  The switch used to take effect one launch late, because it was applied only
  at startup. Applying it on every settings change instead would rewrite the
  login item each time any setting moved, so it is applied on a change only.
*/

describe('autostartNeedsApplying', () => {
  it('applies at launch, when nothing has been applied yet this session', () => {
    expect(autostartNeedsApplying(true, undefined)).toBe(true)
    expect(autostartNeedsApplying(false, undefined)).toBe(true)
  })

  it('applies when the switch is flipped mid-session', () => {
    expect(autostartNeedsApplying(true, false)).toBe(true)
    expect(autostartNeedsApplying(false, true)).toBe(true)
  })

  it('leaves the login item alone when some other setting changed', () => {
    expect(autostartNeedsApplying(true, true)).toBe(false)
    expect(autostartNeedsApplying(false, false)).toBe(false)
  })
})
