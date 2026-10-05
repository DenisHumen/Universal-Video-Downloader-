import { describe, expect, it } from 'vitest'
import { describeError, errorReport, errorText } from './errors'
import { translate, type TranslateFn } from '../i18n'

/*
  The share test button once showed "Error invoking remote method
  'auto:test-smb': SmbError: There is no share by that name on the server." —
  a channel name and a class name in front of the one sentence that mattered.
*/
describe('describeError', () => {
  it('takes the IPC wrapper off and leaves the sentence', () => {
    const err = new Error(
      "Error invoking remote method 'auto:test-smb': SmbError: There is no share by that name on the server."
    )
    expect(describeError(err)).toBe('There is no share by that name on the server.')
  })

  it('drops a class name announcing itself', () => {
    expect(describeError(new Error('TypeError: cannot read that'))).toBe('cannot read that')
  })

  it('leaves an ordinary message exactly as written', () => {
    expect(describeError(new Error('No password is stored for "NAS".'))).toBe(
      'No password is stored for "NAS".'
    )
  })

  it('does not mistake a sentence that merely mentions an error for a prefix', () => {
    expect(describeError('The engine reported an Error: code 3')).toBe(
      'The engine reported an Error: code 3'
    )
  })

  it('copes with things that are not errors at all', () => {
    expect(describeError('plain text')).toBe('plain text')
    expect(describeError(undefined)).toBe('Something went wrong.')
    expect(describeError('')).toBe('Something went wrong.')
  })

  // A plain `throw new Error()` in main arrives as "...': Error: <sentence>",
  // and the bare "Error:" used to survive the unwrapping.
  it('takes off a bare Error: as well as a named class', () => {
    const err = new Error(
      "Error invoking remote method 'download:start': Error: The download folder is not writable."
    )
    expect(describeError(err)).toBe('The download folder is not writable.')
  })

  it('uses the caller’s translated fallback when there are no words at all', () => {
    expect(describeError(new Error(''), 'не удалось начать загрузку')).toBe('не удалось начать загрузку')
    expect(describeError(new Error('disk on fire'), 'не удалось начать загрузку')).toBe('disk on fire')
  })
})

const en: TranslateFn = (key, params) => translate('en', key, params)
const ru: TranslateFn = (key, params) => translate('ru', key, params)

/*
  An engine that couldn't be installed - offline on the very first run - used
  to reach the home card as "Error invoking remote method 'media:detect':
  Error: net::ERR_INTERNET_DISCONNECTED", the one English line in the window.
*/
describe('errorText', () => {
  it('turns a missing engine into a sentence in the user’s language', () => {
    const failure = { error: 'net::ERR_INTERNET_DISCONNECTED', errorCode: 'engineMissing' as const }
    expect(errorText(en, failure)).toBe(en('err.engineMissing'))
    expect(errorText(ru, failure)).toBe(ru('err.engineMissing'))
    expect(errorText(ru, failure)).not.toContain('ERR_')
  })

  it('falls back to the engine’s own words for a failure it has no code for', () => {
    expect(errorText(en, { error: '  Something odd happened.  ' })).toBe('Something odd happened.')
  })
})

/*
  The Copy button on a failed row copied only the raw English, so the advice
  the row showed - the half that says what to do - couldn't be pasted anywhere.
*/
describe('errorReport', () => {
  it('copies the translated advice and then the engine’s words', () => {
    const report = errorReport(ru, { error: 'ERROR: [youtube] abc: Video unavailable', errorCode: 'unavailable' })
    expect(report).toBe(`${ru('err.unavailable')}\n\nERROR: [youtube] abc: Video unavailable`)
  })

  it('does not paste the same words twice when there is no translation', () => {
    expect(errorReport(en, { error: 'Something odd happened.' })).toBe('Something odd happened.')
    expect(errorReport(en, { error: 'Something odd happened.', cookieHint: true })).toBe(
      `Something odd happened. ${en('err.cookieHint')}`
    )
  })

  it('falls back to the log when the failure carries no message', () => {
    expect(errorReport(en, { log: 'the last lines of output' })).toBe(
      `${en('error.title')}\n\nthe last lines of output`
    )
  })
})
