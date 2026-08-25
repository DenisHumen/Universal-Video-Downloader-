import { createReadStream, statSync } from 'fs'
import { pipeline } from 'stream/promises'
import { log } from '../log'
import type { SmbTarget } from '@shared/automation'

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

/** SMB status codes worth telling a person apart from one another. */
const STATUS: Record<number, string> = {
  0xc000006d: 'The server rejected that username or password.',
  0xc000006a: 'The server rejected that password.',
  0xc0000064: 'The server does not know that username.',
  0xc0000022: 'That account is not allowed to write there.',
  0xc00000cc: 'There is no share by that name on the server.',
  0xc0000034: 'That path does not exist on the share.',
  0xc000003a: 'That path does not exist on the share.'
}

export class SmbError extends Error {
  constructor(
    message: string,
    /** So callers can tell "fix your password" from "try again later". */
    readonly kind: 'auth' | 'network' | 'path' | 'unknown'
  ) {
    super(message)
    this.name = 'SmbError'
  }
}

/** Turn whatever the library threw into something worth showing a person. */
function wrap(err: unknown, host: string): SmbError {
  const raw = err as { header?: { status?: number | bigint }; message?: string; code?: string }
  const status = raw?.header?.status
  if (status !== undefined) {
    const n = Number(status) >>> 0
    const known = STATUS[n]
    if (known) {
      const kind = n === 0xc0000022 ? 'auth' : n >= 0xc0000034 && n <= 0xc000003a ? 'path' : 'auth'
      return new SmbError(known, n === 0xc00000cc ? 'path' : kind)
    }
    return new SmbError(`The server refused the request (0x${n.toString(16)}).`, 'unknown')
  }
  const message = String(raw?.message ?? raw ?? '')
  if (/timeout|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED|connect_timeout/i.test(message)) {
    return new SmbError(`Could not reach ${host}. Is it on, and on this network?`, 'network')
  }
  return new SmbError(message || 'The share could not be reached.', 'unknown')
}

async function connect(target: SmbTarget, password: string): Promise<{ client: Client; tree: Client }> {
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
    throw wrap(err, target.host)
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
  target: SmbTarget,
  password: string,
  localPath: string,
  remoteDir: string,
  remoteName: string,
  onProgress?: (bytes: number, total: number) => void
): Promise<UploadResult> {
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
  const tempPath = `${finalPath}.uvd-part`

  try {
    if (dir) await ensureDirs(tree, dir)

    const stream = await tree.createFileWriteStream(tempPath)
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
    throw wrap(err, target.host)
  } finally {
    try {
      await client.close()
    } catch {
      /* already gone */
    }
  }
}

/** Check a target works, for the "test this" button in settings. */
export async function testTarget(target: SmbTarget, password: string): Promise<string> {
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
    throw wrap(err, target.host)
  } finally {
    try {
      await client.close()
    } catch {
      /* already gone */
    }
  }
}
