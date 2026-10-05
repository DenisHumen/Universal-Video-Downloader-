import { describe, expect, it } from 'vitest'
import { composeCheckFailure, composeFailure } from './telegram'

/*
  Telegram rejects the whole message over one unescaped `<` or `&`, and both
  turn up in series titles and in the text of an exception. The message that
  says checks keep failing is the one that must not itself fail to send.
*/
describe('composeCheckFailure', () => {
  it('escapes the title and the reason', () => {
    const html = composeCheckFailure('Tom & Jerry <remastered>', 3, 'Unexpected token < in JSON')
    expect(html).toContain('Tom &amp; Jerry &lt;remastered&gt;')
    expect(html).toContain('Unexpected token &lt; in JSON')
    expect(html).not.toContain('<remastered>')
  })

  it('keeps its own markup intact', () => {
    expect(composeCheckFailure('Show', 3, 'gone')).toMatch(/^⚠️ <b>Show<\/b>/)
  })

  it('says how many checks failed', () => {
    expect(composeCheckFailure('Show', 3, 'gone')).toContain('last 3 checks failed')
  })
})

/*
  An episode is now sent to Telegram once, when it is given up on, rather than
  at every failed go. That one message has to say nothing will try again.
*/
describe('composeFailure', () => {
  it('says it gave up after several goes, and where to try again', () => {
    const html = composeFailure('Show', 1, 4, 'Could not reach 192.168.1.10', 3)
    expect(html).toContain('S01E04')
    expect(html).toContain('Failed 3 times')
    expect(html).toContain('watch screen')
  })

  it('says nothing about goes for a single one', () => {
    expect(composeFailure('Show', 1, 4, 'gone')).not.toContain('times')
  })
})
