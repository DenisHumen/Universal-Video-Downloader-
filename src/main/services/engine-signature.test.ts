import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { engineAssets, parseSums } from './engine-dist'
import { YT_DLP_KEYS } from './engine-keys'
import { EngineTrustError, readPackets, verifyDetached, type TrustReason } from './engine-signature'
import { makeSigner, signDetached, type TestSigner } from './engine-signature.testkit'

/*
  The fixtures are yt-dlp's own, byte for byte, from the 2026.10.26 release, and
  are what `gpg --verify SHA2-256SUMS.sig SHA2-256SUMS` accepts. Git is told to
  leave them alone (.gitattributes): a line ending changed on a checkout would
  fail these tests for the right reason and the wrong cause.
*/
const fixtures = join(__dirname, 'fixtures', 'yt-dlp-2026.10.26')
const SUMS = readFileSync(join(fixtures, 'SHA2-256SUMS'))
const SIG = readFileSync(join(fixtures, 'SHA2-256SUMS.sig'))
const FINGERPRINT = 'AC0CBBE6848D6A873464AF4E57CF65933B5A7581'

function reasonFor(attempt: () => unknown): TrustReason | 'passed' | 'other' {
  try {
    attempt()
    return 'passed'
  } catch (err) {
    return err instanceof EngineTrustError ? err.reason : 'other'
  }
}

describe('verifyDetached, on the real release', () => {
  it('accepts yt-dlp’s checksum list and says which key and when', () => {
    const verified = verifyDetached(SUMS, SIG)
    expect(verified.fingerprint).toBe(FINGERPRINT)
    expect(verified.signedAt.toISOString()).toBe('2026-10-26T22:24:41.000Z')
  })

  it('pins the key whose fingerprint gpg reports', () => {
    expect(YT_DLP_KEYS.map((key) => key.fingerprint)).toContain(FINGERPRINT)
  })

  it('refuses a list with one checksum changed', () => {
    const tampered = Buffer.from(SUMS)
    tampered[0] = tampered[0] === 0x30 ? 0x31 : 0x30
    expect(reasonFor(() => verifyDetached(tampered, SIG))).toBe('bad-signature')
  })

  it('refuses a list with a line added, or with its line endings changed', () => {
    const evil = Buffer.concat([SUMS, Buffer.from(`${'0'.repeat(64)}  yt-dlp.exe\n`)])
    expect(reasonFor(() => verifyDetached(evil, SIG))).toBe('bad-signature')
    const crlf = Buffer.from(SUMS.toString('utf-8').replace(/\n/g, '\r\n'))
    expect(reasonFor(() => verifyDetached(crlf, SIG))).toBe('bad-signature')
  })

  it('refuses a signature with any byte changed, apart from the unsigned note of who made it', () => {
    const body = readPackets(SIG)[0].body
    const hashedEnd = 6 + body.readUInt16BE(4)
    // 3 is the packet header. The unhashed area's contents: two length bytes, then a one-subpacket note.
    const looseFrom = 3 + hashedEnd + 2
    const looseTo = looseFrom + body.readUInt16BE(hashedEnd)
    const passed: number[] = []
    for (let at = 0; at < SIG.length; at++) {
      const tampered = Buffer.from(SIG)
      tampered[at] ^= 0x01
      if (reasonFor(() => verifyDetached(SUMS, tampered)) === 'passed') passed.push(at)
    }
    expect(passed.filter((at) => at < looseFrom || at >= looseTo)).toEqual([])
  })

  it('refuses a truncated signature, one with something after it, and none at all', () => {
    for (let length = 0; length < SIG.length; length += 37) {
      expect(reasonFor(() => verifyDetached(SUMS, SIG.subarray(0, length)))).toBe('malformed')
    }
    expect(reasonFor(() => verifyDetached(SUMS, Buffer.concat([SIG, Buffer.from([0xb4, 0x00])])))).toBe('malformed')
    expect(reasonFor(() => verifyDetached(SUMS, Buffer.from('<html>Sign in to Wi-Fi</html>')))).toBe('malformed')
  })

  it('covers everything the app can download, on every system', () => {
    const sums = parseSums(SUMS.toString('utf-8'))
    const systems: [string, string][] = [
      ['win32', 'x64'],
      ['win32', 'ia32'],
      ['win32', 'arm64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'arm'],
      ['freebsd', 'x64']
    ]
    for (const [platform, arch] of systems) {
      const { onedir, onefile } = engineAssets(platform, arch)
      if (onedir) expect(sums.has(onedir.zip), onedir.zip).toBe(true)
      if (onefile) expect(sums.has(onefile), onefile).toBe(true)
    }
  })
})

describe('verifyDetached, with a key made here', () => {
  let mine: TestSigner
  let other: TestSigner
  const DATA = Buffer.from('abc  yt-dlp.exe\n')

  beforeAll(() => {
    mine = makeSigner()
    other = makeSigner()
  })

  it('accepts this signer when pinned, so the refusals below are about the key and not the format', () => {
    expect(verifyDetached(DATA, signDetached(DATA, mine), [mine.pinned]).fingerprint).toBe(mine.pinned.fingerprint)
  })

  it('refuses a good signature by a key that is not pinned', () => {
    expect(reasonFor(() => verifyDetached(DATA, signDetached(DATA, other)))).toBe('unknown-key')
    expect(reasonFor(() => verifyDetached(DATA, signDetached(DATA, other), [mine.pinned]))).toBe('unknown-key')
  })

  it('refuses a forgery that claims to be by the pinned key, whichever way it claims it', () => {
    const forged = signDetached(SUMS, other, { claim: FINGERPRINT })
    expect(reasonFor(() => verifyDetached(SUMS, forged))).toBe('bad-signature')
  })

  it('accepts either key while a rotation is under way, and a file signed by both', () => {
    const keys = [mine.pinned, other.pinned]
    expect(verifyDetached(DATA, signDetached(DATA, mine), keys).fingerprint).toBe(mine.pinned.fingerprint)
    expect(verifyDetached(DATA, signDetached(DATA, other), keys).fingerprint).toBe(other.pinned.fingerprint)
    const both = Buffer.concat([signDetached(DATA, other), signDetached(DATA, mine)])
    expect(verifyDetached(DATA, both, [mine.pinned]).fingerprint).toBe(mine.pinned.fingerprint)
  })

  it('refuses weak hashes, even from a pinned key', () => {
    const sha1 = signDetached(DATA, mine, { hashId: 2, hashName: 'sha1' })
    expect(reasonFor(() => verifyDetached(DATA, sha1, [mine.pinned]))).toBe('malformed')
  })

  it('accepts the other hashes gpg may choose', () => {
    const sha256 = signDetached(DATA, mine, { hashId: 8, hashName: 'sha256' })
    expect(verifyDetached(DATA, sha256, [mine.pinned]).fingerprint).toBe(mine.pinned.fingerprint)
  })

  it('refuses a signature of another type, such as a text-mode one', () => {
    const text = signDetached(DATA, mine, { type: 1 })
    expect(reasonFor(() => verifyDetached(DATA, text, [mine.pinned]))).toBe('malformed')
  })

  it('refuses a critical subpacket it does not understand, as the standard requires', () => {
    const critical = signDetached(DATA, mine, { extraHashed: Buffer.from([2, 0x80 | 99, 0]) })
    expect(reasonFor(() => verifyDetached(DATA, critical, [mine.pinned]))).toBe('malformed')
  })

  it('accepts a signature whose number begins with a zero byte, which the file stores without it', () => {
    // One in 256 signatures does this, and refusing them would refuse one yt-dlp release in 256.
    const all = Array.from({ length: 5000 }, (_, time) => signDetached(DATA, mine, { time }))
    const full = Math.max(...all.map((sig) => sig.length))
    const shortOne = all.find((sig) => sig.length < full)
    expect(shortOne).toBeDefined()
    expect(verifyDetached(DATA, shortOne as Buffer, [mine.pinned]).fingerprint).toBe(mine.pinned.fingerprint)
  })

  it('will not use a pinned key whose bytes are not the ones its fingerprint names', () => {
    const wrong = { ...mine.pinned, fingerprint: other.pinned.fingerprint }
    expect(() => verifyDetached(DATA, signDetached(DATA, mine), [wrong])).toThrow(/does not match its bytes/)
  })
})
