import { randomUUID } from 'crypto'
import { createReadStream, statSync } from 'fs'
import { pipeline } from 'stream/promises'
import { log } from '../log'
import { normaliseSmbTarget, type SmbTarget } from '@shared/automation'

/**
 * Putting a finished episode on a share.
 *
 * `node-smb2` speaks the protocol itself over its own TCP connection, which is
 * why the app can use credentials the machine has not been told about — and
 * also why it sidesteps the Windows redirector's refusal to hold two
 * connections to one server under different names.
 *
 * Two things about that library have to be handled here rather than hoped
 * about, both found by testing it against a real share:
 *
 *  - Left to negotiate it picks NTLMv1, which a modern server refuses. It then
 *    reports the refusal as `STATUS_LOGON_FAILURE`, indistinguishable from a
 *    wrong password — so an app that let it negotiate would tell people their
 *    password was wrong when it was not.
 *  - Failures arrive as raw protocol objects with no message and no code. Every
 *    one is wrapped before it leaves this file.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// The package ships types, but they describe a protocol rather than an API.
type Client = any

const SEP = String.fromCharCode(92)

/** The status FILE_CREATE answers when the name is taken. */
const NAME_COLLISION = 0xc0000035
/** The name is taken by a file somebody has deleted but the server still holds open. */
const DELETE_PENDING = 0xc0000056

export type SmbErrorKind = 'auth' | 'network' | 'path' | 'full' | 'busy' | 'unknown'

/**
 * SMB status codes worth telling a person apart from one another.
 *
 * Each with its kind spelled out. It used to be worked out from where the code
 * fell in a range, which would have called a full disk a password problem the
 * moment one was added.
 */
const STATUS: Record<number, [string, SmbErrorKind]> = {
  0xc000006d: ['The server rejected that username or password.', 'auth'],
  0xc000006a: ['The server rejected that password.', 'auth'],
  0xc0000064: ['The server does not know that username.', 'auth'],
  0xc0000022: ['That account is not allowed to write there.', 'auth'],
  0xc00000cc: ['There is no share by that name on the server.', 'path'],
  0xc0000034: ['That path does not exist on the share.', 'path'],
  0xc000003a: ['That path does not exist on the share.', 'path'],
  0xc0000033: ['The share does not accept that file name.', 'path'],
  [NAME_COLLISION]: ['A file with that name already exists on the share.', 'path'],
  0xc000007f: ['The share is full.', 'full'],
  0xc0000044: ['The account has used up its space on the share.', 'full'],
  0xc0000043: ['That file is open on the server, so it cannot be replaced right now.', 'busy'],
  [DELETE_PENDING]: ['The server is still deleting an earlier copy of that file.', 'busy']
}

export class SmbError extends Error {
  constructor(
    message: string,
    /**
     * What sort of trouble it is. Nothing retries on it: an upload that fails
     * is tried again by the next check, whatever the kind.
     */
    readonly kind: SmbErrorKind
  ) {
    super(message)
    this.name = 'SmbError'
  }
}

/** The SMB status a library failure carries, if it carries one. */
function statusOf(err: unknown): number | undefined {
  const status = (err as { header?: { status?: number | bigint } } | undefined)?.header?.status
  return status === undefined ? undefined : Number(status) >>> 0
}

/** A create refused because the name is in use, by a finished file or one on its way out. */
function nameTaken(err: unknown): boolean {
  const n = statusOf(err)
  return n === NAME_COLLISION || n === DELETE_PENDING
}

/** Turn whatever the library threw into something worth showing a person. */
export function toSmbError(err: unknown, host: string): SmbError {
  const raw = err as { message?: string; code?: string }
  const n = statusOf(err)
  if (n !== undefined) {
    const known = STATUS[n]
    if (known) return new SmbError(known[0], known[1])
    return new SmbError(`The server refused the request (0x${n.toString(16)}).`, 'unknown')
  }
  const message = String(raw?.message ?? raw ?? '')
  if (/timeout|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED|connect_timeout/i.test(message)) {
    return new SmbError(`Could not reach ${host}. Is it on, and on this network?`, 'network')
  }
  return new SmbError(message || 'The share could not be reached.', 'unknown')
}

async function connect(input: SmbTarget, password: string): Promise<{ client: Client; tree: Client }> {
  // Defence in depth: a share field still carrying a whole path is split here
  // too, so a target that escaped the settings migration reaches the right share.
  const target = normaliseSmbTarget(input)
  const SMB2 = (await import('node-smb2')).default as any
  const client = new SMB2.Client(target.host, { connectTimeout: 10_000, requestTimeout: 120_000 })
  try {
    const session = await client.authenticate({
      domain: target.domain || '',
      username: target.username,
      password,
      // Not optional. See the note at the top of this file.
      forceNtlmVersion: 'v2'
    })
    const tree = await session.connectTree(target.share)
    return { client, tree }
  } catch (err) {
    try {
      await client.close()
    } catch {
      /* it may never have opened */
    }
    throw toSmbError(err, target.host)
  }
}

/** Make every level of a path, tolerating the ones already there. */
async function ensureDirs(tree: Client, dir: string): Promise<void> {
  const parts = dir.split(/[\\/]+/).filter(Boolean)
  let sofar = ''
  for (const part of parts) {
    sofar = sofar ? sofar + SEP + part : part
    try {
      if (!(await tree.exists(sofar))) await tree.createDirectory(sofar)
    } catch {
      // A racing creation, or a directory that exists but cannot be stat'd.
      // The upload that follows will fail loudly enough if this really matters.
    }
  }
}

export interface UploadResult {
  remotePath: string
  bytes: number
  seconds: number
}

/**
 * Send one file to the share.
 *
 * Streamed, not read into memory: an episode is hundreds of megabytes and this
 * runs unattended. Uploaded under a temporary name and renamed on success, so
 * the share never briefly holds a half-written episode under the name something
 * else might pick up.
 */
export async function uploadFile(
  input: SmbTarget,
  password: string,
  localPath: string,
  remoteDir: string,
  remoteName: string,
  onProgress?: (bytes: number, total: number) => void
): Promise<UploadResult> {
  const target = normaliseSmbTarget(input)
  const total = statSync(localPath).size
  const { client, tree } = await connect(target, password)
  const started = Date.now()
  // Everything is filed under the folder the share was set up with.
  const dir = [target.path ?? '', remoteDir]
    .join('/')
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(SEP)
  const finalPath = dir ? dir + SEP + remoteName : remoteName
  let tempPath = `${finalPath}.uvd-part`

  try {
    if (dir) await ensureDirs(tree, dir)

    /*
      An upload cut short - the connection dropped, the app quit mid-file -
      leaves its temporary file behind, and the library creates with
      FILE_CREATE, which refuses a name that is taken. Every later upload of
      that episode then failed until somebody deleted the leftover by hand.
      `exists` throws on anything but "not found", hence the catch.
    */
    try {
      if (await tree.exists(tempPath)) await tree.removeFile(tempPath)
    } catch {
      /* the create below will say so if it still matters */
    }

    let stream: Client
    try {
      stream = await tree.createFileWriteStream(tempPath)
    } catch (err) {
      /*
        A leftover the server still holds open - after a power cut, say - stays
        "being deleted" until that handle lets go, and the name with it. Rather
        than wait for that, write beside it under a name of its own.
      */
      if (!nameTaken(err)) throw err
      tempPath = `${finalPath}.${randomUUID().slice(0, 8)}.uvd-part`
      log.warn('upload', 'The temporary name is still taken on the share; using another', {
        host: target.host,
        path: tempPath
      })
      stream = await tree.createFileWriteStream(tempPath)
    }
    if (onProgress) {
      let sent = 0
      stream.on('drain', () => onProgress(sent, total))
      const source = createReadStream(localPath)
      source.on('data', (chunk: Buffer | string) => {
        sent += chunk.length
        onProgress(sent, total)
      })
      await pipeline(source, stream)
    } else {
      await pipeline(createReadStream(localPath), stream)
    }

    // Replace anything already there, rather than failing on a re-run.
    try {
      if (await tree.exists(finalPath)) await tree.removeFile(finalPath)
    } catch {
      /* best effort */
    }
    await tree.renameFile(tempPath, finalPath)

    const seconds = (Date.now() - started) / 1000
    log.info('upload', 'Uploaded to the share', {
      host: target.host,
      share: target.share,
      path: finalPath,
      bytes: total,
      seconds: seconds.toFixed(1)
    })
    return { remotePath: `${target.share}/${finalPath.split(SEP).join('/')}`, bytes: total, seconds }
  } catch (err) {
    // Do not leave a partial file wearing a name that looks finished.
    try {
      await tree.removeFile(tempPath)
    } catch {
      /* it may not exist */
    }
    throw toSmbError(err, target.host)
  } finally {
    try {
      await client.close()
    } catch {
      /* already gone */
    }
  }
}

/** Check a target works, for the "test this" button in settings. */
export async function testTarget(input: SmbTarget, password: string): Promise<string> {
  const target = normaliseSmbTarget(input)
  const { client, tree } = await connect(target, password)
  const folder = (target.path ?? '').split(/[\\/]+/).filter(Boolean).join(SEP)
  try {
    /*
      Report on the folder the files will really land in, not on the share.
      A share that answers while the folder under it is missing is a test that
      passes and an upload that fails, which is the worst of both. A folder that
      is merely not there yet is no failure though - the upload creates every
      level it needs - so it is worth saying so rather than refusing.
    */
    if (folder && !(await tree.exists(folder))) {
      return `Connected. ${folder.split(SEP).join('/')} does not exist yet, and will be created.`
    }
    const entries = await tree.readDirectory(folder)
    const where = folder ? folder.split(SEP).join('/') : target.share
    return `Connected. ${entries.length} item(s) in ${where}.`
  } catch (err) {
    throw toSmbError(err, target.host)
  } finally {
    try {
      await client.close()
    } catch {
      /* already gone */
    }
  }
}
