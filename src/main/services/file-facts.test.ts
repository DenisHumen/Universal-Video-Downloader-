import { describe, expect, it } from 'vitest'
import { fileFactsArgs, plainFileAddress, type FileProbeQuestion } from './file-facts'

const file: FileProbeQuestion = {
  extractor: 'generic',
  formats: [{ url: 'https://files.test/big.mp4', protocol: 'https' }],
  needsAccess: false
}

describe('plainFileAddress', () => {
  it('asks about one plain file with no site behind it', () => {
    expect(plainFileAddress(file)).toBe('https://files.test/big.mp4')
    expect(plainFileAddress({ ...file, extractor: 'HTML5MediaEmbed' })).toBe('https://files.test/big.mp4')
    // Half an answer is still worth finishing.
    expect(plainFileAddress({ ...file, duration: 60 })).toBe('https://files.test/big.mp4')
  })

  it('leaves alone a site the engine knows and what the engine already answered', () => {
    expect(plainFileAddress({ ...file, extractor: 'Youtube' })).toBeUndefined()
    expect(plainFileAddress({ ...file, duration: 60, thumbnail: 'https://files.test/p.jpg' })).toBeUndefined()
  })

  it('does not read a manifest, or a broadcast, or choose among formats', () => {
    expect(plainFileAddress({ ...file, formats: [{ url: 'https://files.test/a.m3u8', protocol: 'm3u8_native' }] })).toBeUndefined()
    expect(plainFileAddress({ ...file, isLive: true })).toBeUndefined()
    expect(plainFileAddress({ ...file, formats: [...file.formats!, ...file.formats!] })).toBeUndefined()
    expect(plainFileAddress({ ...file, formats: [] })).toBeUndefined()
  })

  it('never goes around a proxy or without the headers the file needs', () => {
    expect(plainFileAddress({ ...file, needsAccess: true })).toBeUndefined()
  })
})

describe('fileFactsArgs', () => {
  it('keeps ffmpeg on the web, and the address where only an input can be', () => {
    const args = fileFactsArgs('https://files.test/big.mp4')
    expect(args[args.indexOf('-protocol_whitelist') + 1]).not.toMatch(/file|concat|data/)
    expect(args[args.indexOf('-i') + 1]).toBe('https://files.test/big.mp4')
    expect(args.at(-1)).toBe('pipe:1')
  })
})
