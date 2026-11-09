import { createHash, generateKeyPairSync, sign, type KeyObject } from 'crypto'
import type { PinnedKey } from './engine-keys'

/*
  A signer of our own, for tests only and imported by nothing else: the real
  private key is yt-dlp's, so anything that has to be signed differently, or
  signed at all in a pretend release, is signed with a key made here. The bytes
  it produces follow the same format as yt-dlp's files, and the tests check it
  against the verifier with the key pinned as well as with it not pinned.
*/

function mpi(value: Buffer): Buffer {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const trimmed = value.subarray(start)
  const bits = (trimmed.length - 1) * 8 + (32 - Math.clz32(trimmed[0]))
  const head = Buffer.alloc(2)
  head.writeUInt16BE(bits)
  return Buffer.concat([head, trimmed])
}

export interface TestSigner {
  pinned: PinnedKey
  privateKey: KeyObject
}

export function makeSigner(modulusLength = 2048): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength })
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
  const body = Buffer.concat([
    // Version 4, a creation time nothing reads, RSA.
    Buffer.from([0x04, 0x60, 0x00, 0x00, 0x00, 0x01]),
    mpi(Buffer.from(jwk.n, 'base64url')),
    mpi(Buffer.from(jwk.e, 'base64url'))
  ])
  const fingerprint = createHash('sha1')
    .update(Buffer.from([0x99, body.length >> 8, body.length & 0xff]))
    .update(body)
    .digest('hex')
    .toUpperCase()
  return { pinned: { fingerprint, packet: body.toString('base64') }, privateKey }
}

export interface SignOptions {
  /** Hash algorithm number. */
  hashId?: number
  hashName?: string
  /** Signature type. */
  type?: number
  /** Extra hashed subpackets, already framed. */
  extraHashed?: Buffer
  /** Say the signature is by this fingerprint, signed or not. */
  claim?: string
  /** A different signing time, to make otherwise equal inputs sign differently. */
  time?: number
}

/** A detached version 4 signature packet over `data`, in the same shape gpg writes. */
export function signDetached(data: Buffer, signer: TestSigner, options: SignOptions = {}): Buffer {
  const hashId = options.hashId ?? 10
  const hashName = options.hashName ?? 'sha512'
  const fingerprint = Buffer.from(options.claim ?? signer.pinned.fingerprint, 'hex')
  const time = Buffer.alloc(4)
  time.writeUInt32BE(options.time ?? 0x60000000)
  const hashed = Buffer.concat([
    Buffer.from([fingerprint.length + 2, 33, 4]),
    fingerprint,
    Buffer.from([5, 2]),
    time,
    options.extraHashed ?? Buffer.alloc(0)
  ])
  const covered = Buffer.concat([
    Buffer.from([4, options.type ?? 0, 1, hashId, hashed.length >> 8, hashed.length & 0xff]),
    hashed
  ])
  const trailer = Buffer.alloc(6)
  trailer[0] = 4
  trailer[1] = 0xff
  trailer.writeUInt32BE(covered.length, 2)
  const signed = Buffer.concat([data, covered, trailer])
  const value = sign(hashName, signed, signer.privateKey)
  const unhashed = Buffer.concat([Buffer.from([9, 16]), fingerprint.subarray(-8)])
  const body = Buffer.concat([
    covered,
    Buffer.from([unhashed.length >> 8, unhashed.length & 0xff]),
    unhashed,
    createHash(hashName).update(signed).digest().subarray(0, 2),
    mpi(value)
  ])
  return Buffer.concat([Buffer.from([0x89, body.length >> 8, body.length & 0xff]), body])
}
