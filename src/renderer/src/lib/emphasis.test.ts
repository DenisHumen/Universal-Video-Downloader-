import { describe, expect, it } from 'vitest'
import { detectIsDone, errorLead, telegramChanged } from './emphasis'

const link = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const other = 'https://vimeo.com/76979871'

/*
  With a result on screen, "get" and "download" were both solid: the step
  already taken competed with the one still to take.
*/
describe('detectIsDone', () => {
  it('steps back while the result on screen is for the link in the field', () => {
    expect(detectIsDone({ url: link, detectedUrl: link, showing: true, batchOpen: false })).toBe(true)
  })

  it('ignores the padding a pasted link carries', () => {
    expect(detectIsDone({ url: `  ${link}\n`, detectedUrl: link, showing: true, batchOpen: false })).toBe(
      true
    )
  })

  // A new link is the next step again, even with the old result still showing.
  it('turns loud again for a different link', () => {
    expect(detectIsDone({ url: other, detectedUrl: link, showing: true, batchOpen: false })).toBe(false)
  })

  // Nothing on screen yet: the field and its button are the whole screen.
  it('stays loud with nothing showing', () => {
    expect(detectIsDone({ url: link, detectedUrl: link, showing: false, batchOpen: false })).toBe(false)
    expect(detectIsDone({ url: link, detectedUrl: '', showing: false, batchOpen: false })).toBe(false)
  })

  // The batch panel's "queue N links" is the solid while it is open.
  it('steps back while the batch panel is open', () => {
    expect(detectIsDone({ url: other, detectedUrl: '', showing: false, batchOpen: true })).toBe(true)
  })
})

/*
  The error card made the built-in browser solid whatever the failure, beside
  a retry that is the actual fix when the connection merely dropped.
*/
describe('errorLead', () => {
  it('leads with retry when the link is fine and the moment was not', () => {
    expect(errorLead('network')).toBe('retry')
    expect(errorLead('timeout')).toBe('retry')
    expect(errorLead('rateLimited')).toBe('retry')
  })

  it('leads with the browser when trying again would fail the same way', () => {
    expect(errorLead('unavailable')).toBe('browser')
    expect(errorLead('signIn')).toBe('browser')
    expect(errorLead('emptyPage')).toBe('browser')
    expect(errorLead(undefined)).toBe('browser')
  })
})

// The Telegram save was a permanent solid, armed with nothing to save.
describe('telegramChanged', () => {
  it('has nothing to save for the stored chat id and no token', () => {
    expect(telegramChanged('100000000', '100000000', '')).toBe(false)
    expect(telegramChanged('100000000', ' 100000000 ', '  ')).toBe(false)
    expect(telegramChanged(undefined, '', '')).toBe(false)
  })

  it('saves a new chat id', () => {
    expect(telegramChanged('100000000', '100000001', '')).toBe(true)
    expect(telegramChanged(undefined, '100000000', '')).toBe(true)
  })

  // Emptying the field is a change too, or a saved id could never be removed.
  it('saves a cleared chat id', () => {
    expect(telegramChanged('100000000', '', '')).toBe(true)
  })

  it('saves a typed token, which is never read back to compare', () => {
    expect(telegramChanged('100000000', '100000000', '123456789:AA...')).toBe(true)
  })
})
