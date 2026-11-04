import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmbTarget } from '@shared/automation'

const SEP = String.fromCharCode(92)

/*
  A share, as far as the upload can tell: files by path, and the one rule of
  the library's create that matters here - FILE_CREATE, which refuses a name
  that is already taken.
*/
const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  /** Statuses the next creates are refused with, in order, before the usual rule applies. */
  refuse: [] as number[],
  created: [] as string[],
  /** What readDirectory answers, by the path asked for. */
  listing: new Map<string, { filename: string; type: string; fileAttributes: string[] }[]>(),
  /** What readDirectory and createDirectory were asked for. */
  read: [] as string[],
  dirs: [] as string[],
  /** A status the next readDirectory is refused with. */
  readRefuse: undefined as number | undefined
}))

vi.mock('node-smb2', async () => {
  const { Writable } = await import('stream')
  const refusal = (status: number): unknown => ({ header: { status } })
  const tree = {
    exists: async (path: string) => h.files.has(path),
    createDirectory: async (path: string) => {
      h.dirs.push(path)
    },
    readDirectory: async (path = '') => {
      h.read.push(path)
      if (h.readRefuse !== undefined) throw refusal(h.readRefuse)
      return h.listing.get(path) ?? []
    },
    removeFile: async (path: string) => {
      h.files.delete(path)
    },
    renameFile: async (from: string, to: string) => {
      h.files.set(to, h.files.get(from) ?? '')
      h.files.delete(from)
    },
    createFileWriteStream: async (path: string) => {
      h.created.push(path)
      const status = h.refuse.shift()
      if (status !== undefined) throw refusal(status)
      if (h.files.has(path)) throw refusal(0xc0000035)
      let body = ''
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          body += chunk.toString()
          done()
        },
        final(done) {
          h.files.set(path, body)
          done()
        }
      })
    }
  }
  class Client {
    async authenticate(): Promise<unknown> {
      return { connectTree: async () => tree }
    }
    async close(): Promise<void> {}
  }
  return { default: { Client } }
})
vi.mock('../log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { createSmbFolder, listSmbFolders, toSmbError, uploadFile } = await import('./smb')

const target: SmbTarget = {
  id: 'nas',
  name: 'NAS',
  host: '192.168.1.10',
  share: 'media',
  path: '',
  domain: '',
  username: 'u'
}

/*
  The library reports failures as bare protocol objects. Everything a person
  sees about a refused upload comes out of this table, and a code missing from
  it read as "The server refused the request (0xc000007f)" - for a full disk.
*/
describe('toSmbError', () => {
  const status = (n: number | bigint): unknown => ({ header: { status: n } })

  it.each([
    ['The share is full.', 'full', 0xc000007f],
    ['The account has used up its space on the share.', 'full', 0xc0000044],
    ['The share does not accept that file name.', 'path', 0xc0000033],
    ['That file is open on the server, so it cannot be replaced right now.', 'busy', 0xc0000043],
    ['A file with that name already exists on the share.', 'path', 0xc0000035],
    ['The server is still deleting an earlier copy of that file.', 'busy', 0xc0000056],
    ['The server rejected that username or password.', 'auth', 0xc000006d],
    ['That account is not allowed to write there.', 'auth', 0xc0000022],
    ['There is no share by that name on the server.', 'path', 0xc00000cc],
    ['That path does not exist on the share.', 'path', 0xc000003a]
  ])('says "%s" (%s)', (message, kind, code) => {
    const err = toSmbError(status(code), '192.168.1.10')
    expect(err.message).toBe(message)
    expect(err.kind).toBe(kind)
  })

  // The range rule this replaced called any code outside 0xc0000034-3a a password problem.
  it('does not call a full share a password problem', () => {
    expect(toSmbError(status(0xc000007f), 'nas').kind).not.toBe('auth')
  })

  it('reads a status that arrives as a bigint', () => {
    expect(toSmbError(status(BigInt(0xc000007f)), 'nas').message).toBe('The share is full.')
  })

  it('still names a code it does not know', () => {
    expect(toSmbError(status(0xc0000999), 'nas').message).toContain('0xc0000999')
  })

  it('says the server could not be reached, by name', () => {
    const err = toSmbError(new Error('connect ETIMEDOUT 192.168.1.10:445'), '192.168.1.10')
    expect(err.kind).toBe('network')
    expect(err.message).toContain('192.168.1.10')
  })
})

describe('uploadFile', () => {
  let dir: string
  let local: string
  const final = `Series${SEP}ep.mkv`

  beforeEach(() => {
    h.files.clear()
    h.refuse = []
    h.created = []
    dir = mkdtempSync(join(tmpdir(), 'uvd-smb-'))
    local = join(dir, 'ep.mkv')
    writeFileSync(local, 'video')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /*
    An upload cut short leaves its temporary file on the share, and the
    library's create refuses a name that is taken - so every later upload of
    that episode failed until somebody deleted the leftover by hand.
  */
  it('clears the temporary file an interrupted upload left behind', async () => {
    h.files.set(`${final}.uvd-part`, 'half an episode')

    const result = await uploadFile(target, 'example', local, 'Series', 'ep.mkv')
    expect(result.remotePath).toBe('media/Series/ep.mkv')
    expect(h.files.get(final)).toBe('video')
    expect([...h.files.keys()]).toEqual([final])
  })

  // A leftover the server still holds open cannot go until its handle does; write beside it instead.
  it('writes under a name of its own when the temporary one is still being deleted', async () => {
    h.refuse = [0xc0000056]

    await uploadFile(target, 'example', local, 'Series', 'ep.mkv')
    expect(h.created).toHaveLength(2)
    expect(h.created[1]).toMatch(/ep[.]mkv[.][0-9a-f]{8}[.]uvd-part$/)
    expect(h.files.get(final)).toBe('video')
  })

  it('does not try another name for a refusal that is about something else', async () => {
    h.refuse = [0xc000007f]

    await expect(uploadFile(target, 'example', local, 'Series', 'ep.mkv')).rejects.toMatchObject({
      message: 'The share is full.',
      kind: 'full'
    })
    expect(h.created).toHaveLength(1)
  })

  it('replaces an episode already on the share, as a re-run should', async () => {
    h.files.set(final, 'the old copy')
    await uploadFile(target, 'example', local, 'Series', 'ep.mkv')
    expect(h.files.get(final)).toBe('video')
  })
})

/*
  The in-app folder browser. The library answers with every entry, files and
  "." and ".." among them; only folders somebody would pick are worth a row.
*/
describe('listSmbFolders', () => {
  const dir = (filename: string, ...extra: string[]) => ({
    filename,
    type: 'Directory',
    fileAttributes: ['Directory', ...extra]
  })
  const file = (filename: string) => ({ filename, type: 'File', fileAttributes: ['Archive'] })

  beforeEach(() => {
    h.listing.clear()
    h.read = []
    h.dirs = []
    h.readRefuse = undefined
  })

  it('keeps only folders, without "." and "..", sorted ignoring case', async () => {
    h.listing.set('', [
      dir('.'),
      dir('..'),
      dir('video'),
      file('notes.txt'),
      dir('Backups'),
      dir('archive'),
      file('Zed.mkv')
    ])
    expect(await listSmbFolders(target, 'pw', '')).toEqual(['archive', 'Backups', 'video'])
  })

  it('leaves out what a file manager hides', async () => {
    h.listing.set('', [dir('.snapshots'), dir('$RECYCLE.BIN', 'Hidden', 'System'), dir('media')])
    expect(await listSmbFolders(target, 'pw', '')).toEqual(['media'])
  })

  it('sorts numbered folders the way people count', async () => {
    h.listing.set('', [dir('Season 10'), dir('Season 2'), dir('Season 1')])
    expect(await listSmbFolders(target, 'pw', '')).toEqual(['Season 1', 'Season 2', 'Season 10'])
  })

  it('asks for a nested folder in the separator the protocol wants', async () => {
    h.listing.set(['video', 'series'].join(SEP), [dir('Severance')])
    expect(await listSmbFolders(target, 'pw', '/video/series/')).toEqual(['Severance'])
    expect(h.read).toEqual([['video', 'series'].join(SEP)])
  })

  it('says why, in words, when the server refuses', async () => {
    h.readRefuse = 0xc0000034
    await expect(listSmbFolders(target, 'pw', 'gone')).rejects.toMatchObject({
      message: 'That path does not exist on the share.',
      kind: 'path'
    })
  })
})

describe('createSmbFolder', () => {
  beforeEach(() => {
    h.dirs = []
  })

  it('makes the folder inside its parent and answers with its path', async () => {
    expect(await createSmbFolder(target, 'pw', 'video/series', ' New Show ')).toBe('video/series/New Show')
    expect(h.dirs).toEqual([['video', 'series', 'New Show'].join(SEP)])
  })

  it.each(['', '  ', '..', 'a/b', 'what?'])('refuses the name %j without asking the server', async (name) => {
    await expect(createSmbFolder(target, 'pw', '', name)).rejects.toMatchObject({ kind: 'path' })
    expect(h.dirs).toEqual([])
  })
})
