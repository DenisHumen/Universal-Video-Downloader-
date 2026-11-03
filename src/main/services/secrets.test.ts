import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  secrets.dat through the real module, with Electron 45's asynchronous
  safeStorage standing in. A blob is `<key version>:<value>`: the synchronous
  calls of earlier versions sealed `v1:`, and a `v1:` blob asks to be sealed
  again once the "OS key" has moved on to `v2`.
*/
const h = vi.hoisted(() => ({
  dir: '',
  keyStore: true,
  version: 'v1',
  /** Milliseconds each encryption takes, in call order; missing ones take none. */
  delays: [] as number[],
  sealing: 0,
  mostSealing: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => h.keyStore,
    encryptStringAsync: async (value: string) => {
      const delay = h.delays.shift() ?? 0
      h.sealing++
      h.mostSealing = Math.max(h.mostSealing, h.sealing)
      await new Promise((resolve) => setTimeout(resolve, delay))
      h.sealing--
      return Buffer.from(`${h.version}:${value}`)
    },
    decryptStringAsync: async (blob: Buffer) => {
      const text = blob.toString()
      const [version, ...rest] = text.split(':')
      if (version !== 'v1' && version !== 'v2') throw new Error('Error while decrypting')
      return { result: rest.join(':'), shouldReEncrypt: version !== h.version }
    }
  }
}))

type Secrets = typeof import('./secrets')

const file = (): string => join(h.dir, 'secrets.dat')
const onDisk = (): Record<string, string> => {
  const raw = JSON.parse(readFileSync(file(), 'utf-8')) as Record<string, string>
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()])
  )
}
const seed = (blobs: Record<string, string>): void =>
  writeFileSync(
    file(),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(blobs).map(([k, v]) => [k, Buffer.from(v).toString('base64')])
      )
    )
  )

async function fresh(): Promise<Secrets> {
  vi.resetModules()
  const secrets = await import('./secrets')
  await secrets.initSecrets()
  return secrets
}

describe('the secret store', () => {
  beforeEach(() => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-secrets-'))
    h.keyStore = true
    h.version = 'v1'
    h.delays = []
    h.sealing = 0
    h.mostSealing = 0
  })
  afterEach(() => {
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('opens what the synchronous safeStorage sealed, without rewriting it', async () => {
    // What encryptString() wrote for every version before this one.
    seed({ 'telegram.token': 'v1:123:abc', 'proxy.password': 'v1:hunter2' })
    const before = readFileSync(file(), 'utf-8')
    const secrets = await fresh()
    expect(secrets.getSecret('telegram.token')).toBe('123:abc')
    expect(secrets.getSecret('proxy.password')).toBe('hunter2')
    expect(secrets.hasSecret('proxy.password')).toBe(true)
    await secrets.flushSecrets()
    expect(readFileSync(file(), 'utf-8')).toBe(before)
  })

  it('seals again, and saves, a blob the OS asks to have re-encrypted', async () => {
    seed({ 'telegram.token': 'v1:tok', 'proxy.password': 'v2:pw' })
    h.version = 'v2'
    const secrets = await fresh()
    await secrets.flushSecrets()
    expect(onDisk()).toEqual({ 'telegram.token': 'v2:tok', 'proxy.password': 'v2:pw' })
    expect(secrets.getSecret('telegram.token')).toBe('tok')
  })

  it('skips a blob that does not open here, and keeps the rest', async () => {
    seed({ 'smb.a.password': 'from-another-machine', 'telegram.token': 'v1:tok' })
    const secrets = await fresh()
    expect(secrets.hasSecret('smb.a.password')).toBe(false)
    expect(secrets.getSecret('smb.a.password')).toBeUndefined()
    expect(secrets.getSecret('telegram.token')).toBe('tok')
  })

  it('answers at once and saves in order, the last write winning', async () => {
    const secrets = await fresh()
    // The first sealing is the slow one: unordered, it would land last.
    h.delays = [40, 0, 0]
    const first = secrets.setSecret('proxy.password', 'one')
    expect(secrets.getSecret('proxy.password')).toBe('one')
    const second = secrets.setSecret('proxy.password', 'two')
    const third = secrets.setSecret('telegram.token', 'tok')
    expect(secrets.getSecret('proxy.password')).toBe('two')
    expect(await Promise.all([first, second, third])).toEqual([true, true, true])
    expect(h.mostSealing).toBe(1)
    expect(onDisk()).toEqual({ 'proxy.password': 'v1:two', 'telegram.token': 'v1:tok' })

    await secrets.deleteSecret('proxy.password')
    expect(secrets.hasSecret('proxy.password')).toBe(false)
    expect(onDisk()).toEqual({ 'telegram.token': 'v1:tok' })
  })

  it('keeps secrets in memory only when there is no key store', async () => {
    h.keyStore = false
    const secrets = await fresh()
    expect(secrets.secretsPersist()).toBe(false)
    expect(await secrets.setSecret('proxy.password', 'pw')).toBe(false)
    expect(secrets.getSecret('proxy.password')).toBe('pw')
    expect(secrets.hasSecret('proxy.password')).toBe(true)
    await secrets.flushSecrets()
    expect(existsSync(file())).toBe(false)
  })

  it('holds a quit until the writes on the chain are on disk, then quits once', async () => {
    const secrets = await fresh()
    const idle = { preventDefault: vi.fn() }
    expect(secrets.holdQuitForSecrets(idle, vi.fn())).toBe(false)
    expect(idle.preventDefault).not.toHaveBeenCalled()

    h.delays = [30]
    void secrets.setSecret('telegram.token', 'tok')
    const event = { preventDefault: vi.fn() }
    let onDiskAtQuit: Record<string, string> | null = null
    const quitted = new Promise<void>((resolve) => {
      const quit = (): void => {
        onDiskAtQuit = onDisk()
        resolve()
      }
      expect(secrets.holdQuitForSecrets(event, quit)).toBe(true)
    })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await quitted
    expect(onDiskAtQuit).toEqual({ 'telegram.token': 'v1:tok' })

    // The quit asked for again goes through, even with something new pending.
    void secrets.setSecret('telegram.token', 'later')
    const again = { preventDefault: vi.fn() }
    expect(secrets.holdQuitForSecrets(again, vi.fn())).toBe(false)
    expect(again.preventDefault).not.toHaveBeenCalled()
    await secrets.flushSecrets()
  })
})

/*
  The proxy is the first thing that asks for a secret at startup (its
  password), and the settings only lift a proxy password out of the address
  once it is known whether there is a key store. Both entry points have to open
  the store before either.
*/
describe('startup order', () => {
  const source = (path: string): string => readFileSync(join(__dirname, path), 'utf-8')

  it('opens the secret store before the app applies the proxy, the IPC or the watcher', () => {
    const main = source('../index.ts')
    const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'))
    const init = ready.indexOf('await initSecrets()')
    expect(init).toBeGreaterThan(0)
    for (const later of ['getSettings()', 'applyProxy(', 'registerIpc(', 'startWatcher()']) {
      expect(ready.indexOf(later)).toBeGreaterThan(init)
    }
  })

  it('opens it before the terminal mode reads settings or applies the proxy', () => {
    const cli = source('../cli/run.ts')
    const run = cli.slice(cli.indexOf('async function run('))
    const init = run.indexOf('await initSecrets()')
    expect(init).toBeGreaterThan(0)
    expect(run.indexOf('getSettings()')).toBeGreaterThan(init)
    expect(run.indexOf('applyProxy(')).toBeGreaterThan(init)
  })
})
