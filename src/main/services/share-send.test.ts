import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmbTarget } from '@shared/automation'

const SEP = String.fromCharCode(92)

/* The same stand-in for a share as smb.test.ts. Nothing here connects to anything. */
const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  password: 'example' as string | undefined,
  refuse: undefined as number | undefined,
  passwords: [] as string[]
}))

vi.mock('node-smb2', async () => {
  const { Writable } = await import('stream')
  const tree = {
    exists: async (path: string) => h.files.has(path),
    createDirectory: async () => undefined,
    removeFile: async (path: string) => void h.files.delete(path),
    renameFile: async (from: string, to: string) => {
      h.files.set(to, h.files.get(from) ?? '')
      h.files.delete(from)
    },
    createFileWriteStream: async (path: string) => {
      if (h.refuse !== undefined) throw { header: { status: h.refuse } }
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
    async authenticate(login: { password: string }): Promise<unknown> {
      h.passwords.push(login.password)
      return { connectTree: async () => tree }
    }
    async close(): Promise<void> {}
  }
  return { default: { Client } }
})
vi.mock('node-smb2/dist/client/File', () => ({
  default: class {
    fileSize: bigint | undefined
    async open(path: string): Promise<void> {
      this.fileSize = BigInt(Buffer.byteLength(h.files.get(path) ?? ''))
    }
    async close(): Promise<void> {}
  }
}))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./secrets', () => ({
  SECRET: { smbPassword: (id: string) => `smb.${id}.password` },
  getSecretWhenReady: async () => h.password
}))

const { sendToShare } = await import('./share-send')

const target: SmbTarget = {
  id: 'nas',
  name: 'NAS',
  host: '192.168.1.10',
  share: 'media',
  path: 'configured',
  domain: '',
  username: 'u'
}

describe('sendToShare', () => {
  let dir: string
  let local: string
  const request = { id: 'row', targetId: 'nas', folder: 'video/films' }
  const final = `video${SEP}films${SEP}film.mp4`

  beforeEach(() => {
    h.files.clear()
    h.password = 'example'
    h.refuse = undefined
    h.passwords = []
    dir = mkdtempSync(join(tmpdir(), 'uvd-send-'))
    local = join(dir, 'film.mp4')
    writeFileSync(local, 'video')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sends with the stored password, to the folder as picked, and reports progress', async () => {
    const seen: number[] = []
    const result = await sendToShare(request, local, [target], (bytes) => seen.push(bytes))
    expect(result).toEqual({ status: 'sent', remotePath: 'media/video/films/film.mp4' })
    expect(h.passwords).toEqual(['example'])
    expect(h.files.get(final)).toBe('video')
    expect(seen[seen.length - 1]).toBe(5)
  })

  it('asks rather than overwrites, and replaces only when told', async () => {
    h.files.set(final, 'the old copy')
    expect(await sendToShare(request, local, [target])).toEqual({ status: 'exists', name: 'film.mp4' })
    expect(h.files.get(final)).toBe('the old copy')

    expect((await sendToShare({ ...request, replace: true }, local, [target])).status).toBe('sent')
    expect(h.files.get(final)).toBe('video')
  })

  it('says so when no password is stored, without connecting', async () => {
    h.password = undefined
    expect(await sendToShare(request, local, [target])).toMatchObject({ status: 'failed', kind: 'noPassword' })
    expect(h.passwords).toEqual([])
  })

  it('says so when the share has been removed', async () => {
    expect(await sendToShare(request, local, [])).toMatchObject({ status: 'failed', kind: 'noTarget' })
  })

  it('keeps the kind of a refusal, so the window can say it properly', async () => {
    h.refuse = 0xc000007f
    expect(await sendToShare(request, local, [target])).toMatchObject({ status: 'failed', kind: 'full' })
  })
})

describe('cleanShareRequest', () => {
  const good = { id: 'row', targetId: 'nas', folder: 'video/2026' }

  it('takes a good request, with no folder as the share itself', async () => {
    const { cleanShareRequest } = await import('./share-send')
    expect(cleanShareRequest(good)).toEqual({ ...good, replace: false })
    expect(cleanShareRequest({ ...good, folder: '', replace: true })).toEqual({ ...good, folder: '', replace: true })
    // A dot inside a name is a name.
    expect(cleanShareRequest({ ...good, folder: 'v1.2/..hidden' })?.folder).toBe('v1.2/..hidden')
  })

  it.each([
    ['nothing', undefined],
    ['not an object', 'row'],
    ['no id', { targetId: 'nas', folder: '' }],
    ['an empty id', { ...good, id: '' }],
    ['an id that is not a string', { ...good, id: 7 }],
    ['no target', { id: 'row', folder: '' }],
    ['a target that is not a string', { ...good, targetId: {} }],
    ['no folder', { id: 'row', targetId: 'nas' }],
    ['a folder that is not a string', { ...good, folder: ['a'] }],
    ['a climb out', { ...good, folder: '../secret' }],
    ['a climb partway', { ...good, folder: 'a/../../b' }],
    ['a climb with the other slash', { ...good, folder: 'a\\..\\b' }],
    ['a dot segment', { ...good, folder: 'a/./b' }]
  ])('refuses %s', async (_name, raw) => {
    const { cleanShareRequest } = await import('./share-send')
    expect(cleanShareRequest(raw)).toBeNull()
  })
})
