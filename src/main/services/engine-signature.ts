import { createHash, createPublicKey, verify, type KeyObject } from 'crypto'
import { YT_DLP_KEYS, type PinnedKey } from './engine-keys'

/*
  Whether a yt-dlp release was signed by yt-dlp.

  The checksum list comes from the same release as the files it vouches for, so
  on its own it catches a bad download and nothing else: whoever can replace the
  engine can replace the list. The engine then runs with the person's cookies.
  `SHA2-256SUMS.sig` is a detached OpenPGP signature over that list, and the key
  that must have made it is compiled into this app (engine-keys.ts).

  Just enough of RFC 4880 / RFC 9580 to read one kind of packet: a version 4
  RSA signature over a binary document. Node's crypto does the arithmetic, so
  there is no dependency to trust. Everything else is refused rather than
  skipped: a version 6 signature, say, means a new key and so a new app release
  anyway, and a parser that guesses at what it does not understand is how
  signature checks come to pass things they should not.
*/

export type TrustReason =
  /** The release has no signature file at all. */
  | 'no-signature'
  /** What is there cannot be read as the kind of signature the app understands. */
  | 'malformed'
  /** Made by a key this build does not have: a rotation, or a forgery. */
  | 'unknown-key'
  /** Made by, or claiming to be by, a key this build has, and it does not match. */
  | 'bad-signature'
  /** The signed list has no line for this file, or a different checksum on it. */
  | 'checksum'

/**
 * The release could not be shown to be yt-dlp's, so nothing from it is run.
 *
 * Its own class because the answer differs from any other failure: the engine in
 * use is kept and the person is told, no fallback is worth trying, and it says
 * nothing about whether a build can run here.
 */
export class EngineTrustError extends Error {
  readonly reason: TrustReason
  constructor(reason: TrustReason, detail: string) {
    // `engineError.ts` tells this failure apart by these words; they cross IPC as text.
    super(`Engine authenticity check failed: ${detail}`)
    this.name = 'EngineTrustError'
    this.reason = reason
  }
}

function malformed(detail: string): EngineTrustError {
  return new EngineTrustError('malformed', `the signature cannot be read (${detail}).`)
}

interface Packet {
  tag: number
  body: Buffer
}

/** The packets in `buf`, which must be nothing else and end exactly where the last one does. */
export function readPackets(buf: Buffer): Packet[] {
  const packets: Packet[] = []
  let p = 0
  const need = (n: number): void => {
    if (p + n > buf.length) throw malformed('it is cut short')
  }
  while (p < buf.length) {
    const header = buf[p++]
    if (!(header & 0x80)) throw malformed('not an OpenPGP packet')
    let tag: number
    let length: number
    if (header & 0x40) {
      tag = header & 0x3f
      need(1)
      const first = buf[p++]
      if (first < 192) length = first
      else if (first < 224) {
        need(1)
        length = ((first - 192) << 8) + buf[p++] + 192
      } else if (first === 255) {
        need(4)
        length = buf.readUInt32BE(p)
        p += 4
      } else throw malformed('a partial length')
    } else {
      tag = (header >> 2) & 0x0f
      const type = header & 0x03
      if (type === 3) throw malformed('an open-ended length')
      const size = 1 << type
      need(size)
      length = buf.readUIntBE(p, size)
      p += size
    }
    need(length)
    packets.push({ tag, body: buf.subarray(p, p + length) })
    p += length
  }
  return packets
}

/** One big number: a bit count, then that many bits. */
function readMpi(buf: Buffer, at: number): { value: Buffer; next: number } {
  if (at + 2 > buf.length) throw malformed('a number is cut short')
  const size = Math.ceil(buf.readUInt16BE(at) / 8)
  const next = at + 2 + size
  if (next > buf.length) throw malformed('a number is cut short')
  return { value: buf.subarray(at + 2, next), next }
}

interface Subpacket {
  type: number
  critical: boolean
  data: Buffer
}

function readSubpackets(buf: Buffer): Subpacket[] {
  const list: Subpacket[] = []
  let p = 0
  while (p < buf.length) {
    let length = buf[p++]
    if (length >= 255) {
      if (p + 4 > buf.length) throw malformed('a subpacket is cut short')
      length = buf.readUInt32BE(p)
      p += 4
    } else if (length >= 192) {
      if (p + 1 > buf.length) throw malformed('a subpacket is cut short')
      length = ((length - 192) << 8) + buf[p++] + 192
    }
    if (length < 1 || p + length > buf.length) throw malformed('a subpacket is cut short')
    list.push({ type: buf[p] & 0x7f, critical: (buf[p] & 0x80) !== 0, data: buf.subarray(p + 1, p + length) })
    p += length
  }
  return list
}

const SIG_BINARY_DOCUMENT = 0x00
const ALG_RSA = 1
const SUB_CREATED = 2
const SUB_ISSUER_KEY_ID = 16
const SUB_ISSUER_FINGERPRINT = 33

/** Hash algorithms a signature may use. MD5, SHA-1 and RIPEMD-160 have numbers too, and are refused. */
const HASHES: Record<number, string> = { 8: 'sha256', 9: 'sha384', 10: 'sha512' }

interface Signature {
  hash: string
  /** The part of the packet the signature covers. */
  covered: Buffer
  left16: Buffer
  value: Buffer
  signedAt: Date
  /** Who it says made it. Not covered in every case, so used only to word the failure. */
  issuer?: string
}

function parseSignature(body: Buffer): Signature {
  if (body.length < 6) throw malformed('it is cut short')
  if (body[0] !== 4) throw malformed(`signature version ${body[0]}`)
  if (body[1] !== SIG_BINARY_DOCUMENT) throw malformed(`signature type ${body[1]}`)
  if (body[2] !== ALG_RSA) throw malformed(`key algorithm ${body[2]}`)
  const hash = HASHES[body[3]]
  if (!hash) throw malformed(`hash algorithm ${body[3]}`)

  const hashedEnd = 6 + body.readUInt16BE(4)
  if (hashedEnd + 2 > body.length) throw malformed('it is cut short')
  const hashed = readSubpackets(body.subarray(6, hashedEnd))
  const unhashedEnd = hashedEnd + 2 + body.readUInt16BE(hashedEnd)
  if (unhashedEnd + 2 > body.length) throw malformed('it is cut short')
  const unhashed = readSubpackets(body.subarray(hashedEnd + 2, unhashedEnd))

  // "Critical" means a reader that does not understand it must not accept the signature.
  const known = new Set([SUB_CREATED, SUB_ISSUER_KEY_ID, SUB_ISSUER_FINGERPRINT])
  const refused = hashed.find((sub) => sub.critical && !known.has(sub.type))
  if (refused) throw malformed(`critical subpacket ${refused.type}`)

  const created = hashed.find((sub) => sub.type === SUB_CREATED)
  if (!created || created.data.length !== 4) throw malformed('no signing time')

  const { value, next } = readMpi(body, unhashedEnd + 2)
  if (next !== body.length) throw malformed('extra bytes after the signature')

  const all = [...hashed, ...unhashed]
  const fingerprint = all.find((sub) => sub.type === SUB_ISSUER_FINGERPRINT)
  const keyId = all.find((sub) => sub.type === SUB_ISSUER_KEY_ID)
  const issuer = fingerprint?.data.subarray(1).toString('hex') ?? keyId?.data.toString('hex')

  return {
    hash,
    covered: body.subarray(0, hashedEnd),
    left16: body.subarray(unhashedEnd, unhashedEnd + 2),
    value,
    signedAt: new Date(created.data.readUInt32BE(0) * 1000),
    issuer: issuer?.toUpperCase()
  }
}

interface LoadedKey {
  fingerprint: string
  key: KeyObject
  /** The modulus's length. A signature must be exactly this long to be checked. */
  size: number
}

/** A pinned key, once its bytes have been seen to be the ones its fingerprint names. */
export function loadKey(pinned: PinnedKey): LoadedKey {
  const body = Buffer.from(pinned.packet, 'base64')
  const fingerprint = createHash('sha1')
    .update(Buffer.from([0x99, body.length >> 8, body.length & 0xff]))
    .update(body)
    .digest('hex')
    .toUpperCase()
  if (fingerprint !== pinned.fingerprint) throw new Error(`Pinned key ${pinned.fingerprint} does not match its bytes.`)
  if (body[0] !== 4 || body[5] !== ALG_RSA) throw new Error(`Pinned key ${pinned.fingerprint} is not a v4 RSA key.`)
  const n = readMpi(body, 6)
  const e = readMpi(body, n.next)
  return {
    fingerprint,
    size: n.value.length,
    key: createPublicKey({
      key: { kty: 'RSA', n: n.value.toString('base64url'), e: e.value.toString('base64url') },
      format: 'jwk'
    })
  }
}

function matches(signature: Signature, data: Buffer, loaded: LoadedKey): boolean {
  // The number is stored without its leading zeros, and the check wants it at full width.
  if (signature.value.length > loaded.size) return false
  const value = Buffer.alloc(loaded.size)
  signature.value.copy(value, loaded.size - signature.value.length)
  return verify(signature.hash, data, loaded.key, value)
}

export interface VerifiedSignature {
  /** The pinned key that made it. */
  fingerprint: string
  signedAt: Date
}

/**
 * The key from `keys` that signed `data`, or a reason there is none.
 *
 * Every key is tried, whoever the signature says it is from: the issuer can sit
 * in the part of the packet nothing covers, so it decides only how a failure is
 * worded. More than one signature packet passes on any good one, which is what
 * a release signed by both keys during a rotation would look like.
 */
export function verifyDetached(
  data: Buffer,
  sig: Buffer,
  keys: readonly PinnedKey[] = YT_DLP_KEYS
): VerifiedSignature {
  const packets = readPackets(sig)
  if (packets.length === 0) throw malformed('it is empty')
  const stray = packets.find((packet) => packet.tag !== 2)
  if (stray) throw malformed(`a packet of type ${stray.tag}`)
  const signatures = packets.map((packet) => parseSignature(packet.body))
  const loaded = keys.map(loadKey)

  for (const signature of signatures) {
    // The signed bytes: the document, the covered part of the packet, then the version 4 trailer.
    const trailer = Buffer.alloc(6)
    trailer[0] = 0x04
    trailer[1] = 0xff
    trailer.writeUInt32BE(signature.covered.length, 2)
    const signed = Buffer.concat([data, signature.covered, trailer])
    // Not a security check, since nothing covers these two bytes; gpg refuses on it, and so does this.
    if (!createHash(signature.hash).update(signed).digest().subarray(0, 2).equals(signature.left16)) continue
    for (const key of loaded) {
      if (matches(signature, signed, key)) return { fingerprint: key.fingerprint, signedAt: signature.signedAt }
    }
  }

  const issuers = signatures.map((signature) => signature.issuer ?? 'nobody it names')
  const known = signatures.some(({ issuer }) =>
    loaded.some((key) => issuer && (key.fingerprint === issuer || key.fingerprint.endsWith(issuer)))
  )
  if (known) throw new EngineTrustError('bad-signature', 'the signature does not match the checksum list.')
  throw new EngineTrustError('unknown-key', `the release is signed by a key this version does not know (${issuers.join(', ')}).`)
}
