import { describe, expect, it } from 'vitest'
import { describeError } from './errors'

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
})
