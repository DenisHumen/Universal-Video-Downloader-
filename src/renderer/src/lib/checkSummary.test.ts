import { describe, expect, it } from 'vitest'
import { translate, type TranslateFn } from '../i18n'
import { describeCheck } from './checkSummary'

const en: TranslateFn = (key, vars) => translate('en', key, vars)
const ru: TranslateFn = (key, vars) => translate('ru', key, vars)
const date = (at: number): string => new Date(at).toISOString().slice(0, 10)

/*
  The toast said "checked" whatever happened - nothing new, episodes found on a
  paused watch and left there, or a watch already busy that was not checked at
  all.
*/
describe('describeCheck', () => {
  it('says when the watch was busy rather than claiming a check', () => {
    expect(describeCheck({ busy: true }, en, date)).toEqual({
      text: 'already on it — still checking or downloading',
      kind: 'info'
    })
  })

  it('passes a failure through as an error', () => {
    expect(describeCheck({ error: 'HTTP 503' }, en, date)).toEqual({ text: 'HTTP 503', kind: 'error' })
  })

  it('counts what went to the queue', () => {
    expect(describeCheck({ fresh: 3, queued: 3, paused: false }, en, date)).toEqual({
      text: '3 new episodes are in the queue',
      kind: 'success'
    })
    expect(describeCheck({ fresh: 1, queued: 1, paused: false }, en, date).text).toBe(
      'a new episode is in the queue'
    )
    expect(describeCheck({ fresh: 3, queued: 3, paused: false }, ru, date).text).toBe(
      'новых серий в очереди: 3'
    )
  })

  it('says when one check found more than it takes at once', () => {
    expect(describeCheck({ fresh: 40, queued: 25, paused: false }, en, date).text).toBe(
      '40 new episodes found; 25 are in the queue, the rest come with the next check'
    )
  })

  it('says nothing new when there was nothing new, paused or not', () => {
    expect(describeCheck({ fresh: 0, queued: 0, paused: false }, en, date).text).toBe('nothing new')
    expect(describeCheck({ fresh: 0, queued: 0, paused: true }, en, date).text).toBe('nothing new')
  })

  it('tells a paused watch what it found and how to get it', () => {
    expect(describeCheck({ fresh: 2, queued: 0, paused: true }, en, date)).toEqual({
      text: 'paused — found 2 new; resume to download them',
      kind: 'info'
    })
  })

  it('gives the expected date for a title that is not out, when the site has one', () => {
    const at = Date.UTC(2026, 11, 24)
    expect(describeCheck({ notOut: true, releaseAt: at }, en, date).text).toBe(
      'not out yet, expected 2026-12-24'
    )
    expect(describeCheck({ notOut: true }, en, date).text).toBe('not out yet')
  })
})
