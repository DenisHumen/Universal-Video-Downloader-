import { randomUUID } from 'crypto'
import { createReadStream, statSync } from 'fs'
import { pipeline } from 'stream/promises'
import { log } from '../log'
import { normaliseSmbTarget, safeFileName, type SmbTarget } from '@shared/automation'

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

export type SmbErrorKind = 'auth' | 'network' | 'path' | 'full' | 'busy' | 'exists' | 'unknown'

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
  // The library reads a status off a timeout that has none, and throws that instead of the timeout.
  if (err instanceof TypeError && /reading 'status'|reading 'header'/.test(message)) {
    return new SmbError(`Could not reach ${host}. Is it on, and on this network?`, 'network')
  }
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

/**
 * A name as the server has it. The library hands every entry of a listing back
 * as `./name`; only a name that itself starts with a dot comes through bare.
 */
function entryName(filename: string): string {
  return filename.startsWith('./') ? filename.slice(2) : filename
}

/** How long the server is given to show the whole file before the upload is called short. Tests shorten it. */
export const smbTiming = { sizeSettleMs: 10_000 }

/**
 * How many bytes of `path` the share holds, by opening it and reading what the
 * server says. Not from a listing: the library reads one page of a folder, and
 * in a full one the file would simply not be on it.
 */
async function sizeOnShare(tree: Client, path: string): Promise<bigint> {
  const File = ((await import('node-smb2/dist/client/File')) as any).default
  const file = new File(tree)
  tree.registerFile?.(file)
  try {
    await file.open(path)
    return BigInt(file.fileSize ?? -1)
  } finally {
    try {
      await file.close()
    } catch {
      /* never opened */
    }
  }
}

/**
 * Refuse an upload the share did not keep all of.
 *
 * The stream finishing is not the server agreeing: the library takes an
 * interim "pending" answer to a write for the final one, and never reads the
 * answer that follows, so a share that filled up half-way looked like success.
 * The caller deletes the local file on that success. The size is given a few
 * seconds to arrive, since the last writes may still be landing.
 */
async function assertWholeFile(tree: Client, path: string, total: number): Promise<void> {
  const want = BigInt(total)
  const deadline = Date.now() + smbTiming.sizeSettleMs
  let have = -1n
  for (;;) {
    have = await sizeOnShare(tree, path)
    if (have === want) return
    if (Date.now() >= deadline) break
    await new Promise((r) => setTimeout(r, 250))
  }
  log.warn('upload', 'The share did not keep the whole file', { path, have: String(have), want: String(want) })
  throw new SmbError('The share did not keep the whole file.', 'full')
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
 *
 * `replace` is for a watch re-running an episode it already sent, which is its
 * own file. Somebody sending a file by hand has not said anything about what is
 * on the share, so with `replace` off a name that is taken stops the upload with
 * kind 'exists' and nothing on the share is touched: looked at before a byte is
 * sent, and again before the rename, because a big file takes long enough for
 * somebody else to put one there.
 */
export async function uploadFile(
  input: SmbTarget,
  password: string,
  localPath: string,
  remoteDir: string,
  remoteName: string,
  onProgress?: (bytes: number, total: number) => void,
  replace = true
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
  // Nothing may have renamed this file: the name is then the site's, and a share is stricter than a disk.
  const name = safeFileName(remoteName)
  const finalPath = dir ? dir + SEP + name : name
  let tempPath = `${finalPath}.uvd-part`
  const refuseIfTaken = async (): Promise<void> => {
    if (!replace && (await tree.exists(finalPath))) {
      throw new SmbError('A file with that name already exists on the share.', 'exists')
    }
  }

  try {
    if (dir) await ensureDirs(tree, dir)
    await refuseIfTaken()

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

    await assertWholeFile(tree, tempPath, total)
    await refuseIfTaken()
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
    throw err instanceof SmbError ? err : toSmbError(err, target.host)
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

/** A share-relative folder, in the separator the protocol wants. */
const toRemote = (folder: string): string => folder.split(/[\\/]+/).filter(Boolean).join(SEP)

/** Connect, run one thing against the share, and always hang up. */
async function onShare<T>(input: SmbTarget, password: string, run: (tree: Client) => Promise<T>): Promise<T> {
  const target = normaliseSmbTarget(input)
  const { client, tree } = await connect(target, password)
  try {
    return await run(tree)
  } catch (err) {
    throw err instanceof SmbError ? err : toSmbError(err, target.host)
  } finally {
    try {
      await client.close()
    } catch {
      /* already gone */
    }
  }
}

/**
 * The folders directly under one folder of a share, for the in-app browser.
 *
 * Only folders: a file is not somewhere an episode can be sent. "." and ".."
 * go, and so does what a file manager hides by default - names starting with
 * a dot, and anything the server marks hidden ($RECYCLE.BIN, System Volume
 * Information). Sorted the way people read a list, ignoring case.
 */
export async function listSmbFolders(input: SmbTarget, password: string, folder: string): Promise<string[]> {
  return onShare(input, password, async (tree) => {
    const entries: { filename: string; type?: string; fileAttributes?: string[] }[] = await tree.readDirectory(
      toRemote(folder)
    )
    return entries
      .filter((e) => e.type === 'Directory' || Boolean(e.fileAttributes?.includes('Directory')))
      .filter((e) => !e.fileAttributes?.includes('Hidden'))
      .map((e) => entryName(e.filename))
      .filter((name) => name && !name.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  })
}

/** Characters no SMB name may hold. */
const BAD_NAME = /[\\/:*?"<>|]/

/**
 * Make one folder inside another, for "New Folder" in the browser. Answers
 * with the new folder's share-relative path, '/'-separated.
 */
export async function createSmbFolder(
  input: SmbTarget,
  password: string,
  parent: string,
  name: string
): Promise<string> {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..' || BAD_NAME.test(clean)) {
    throw new SmbError('The share does not accept that file name.', 'path')
  }
  const parts = [...parent.split(/[\\/]+/).filter(Boolean), clean]
  await onShare(input, password, (tree) => tree.createDirectory(parts.join(SEP)))
  return parts.join('/')
}
