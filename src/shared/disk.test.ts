import { describe, expect, it } from 'vitest'
import { cleanEstimate, diskVerdict, roomNeeded } from './disk'

const free = (bytes: number, reliable = true): { bytes: number; reliable: boolean } => ({ bytes, reliable })

describe('the room a download needs', () => {
  it('is the file itself, for one stream', () => {
    expect(roomNeeded({ bytes: 100, exact: true, merging: false })).toBe(100)
  })

  it('is about twice that when merging: both streams and the result', () => {
    expect(roomNeeded({ bytes: 100, exact: true, merging: true })).toBe(200)
  })

  it('takes off what a retry already has on disk, but never the merged copy', () => {
    expect(roomNeeded({ bytes: 100, exact: true, merging: false }, 60)).toBe(40)
    expect(roomNeeded({ bytes: 100, exact: true, merging: true }, 60)).toBe(140)
    expect(roomNeeded({ bytes: 100, exact: true, merging: true }, 500)).toBe(100)
  })
})

describe('will it fit', () => {
  const exact = { bytes: 100, exact: true, merging: false }

  it('fits when it does, to the byte', () => {
    expect(diskVerdict(exact, free(100))).toBe('fits')
  })

  it('refuses only a stated size against a disk it can believe', () => {
    expect(diskVerdict(exact, free(99))).toBe('wontFit')
  })

  it('warns when the size is a guess', () => {
    expect(diskVerdict({ ...exact, exact: false }, free(99))).toBe('mayNotFit')
  })

  it('warns when the disk is a share', () => {
    expect(diskVerdict(exact, free(99, false))).toBe('mayNotFit')
  })

  it('counts both streams when merging', () => {
    expect(diskVerdict({ ...exact, merging: true }, free(150))).toBe('wontFit')
    expect(diskVerdict({ ...exact, merging: true }, free(200))).toBe('fits')
  })

  it('says nothing when either side is unknown', () => {
    expect(diskVerdict(undefined, free(1))).toBe('fits')
    expect(diskVerdict(exact, undefined)).toBe('fits')
  })
})

describe('an estimate from the window', () => {
  it('keeps what it recognises', () => {
    expect(cleanEstimate({ bytes: 5, exact: true, merging: true, extra: 1 })).toEqual({ bytes: 5, exact: true, merging: true })
  })

  it('takes anything less than certain to be a guess', () => {
    expect(cleanEstimate({ bytes: 5, exact: 'yes' })).toEqual({ bytes: 5, exact: false, merging: false })
  })

  it.each([[undefined], [null], ['5'], [{}], [{ bytes: -1 }], [{ bytes: 0 }], [{ bytes: Infinity }], [{ bytes: '5' }]])(
    'refuses %j',
    (raw) => {
      expect(cleanEstimate(raw)).toBeUndefined()
    }
  )
})
