import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  `uvd` claims the app's cookies, and has a Chromium profile of its own with no
  sign-ins in it. So it reads the jar the app wrote and never writes one. All of
  this runs against a made-up jar in a temporary folder.
*/
const h = vi.hoisted(() => ({ dir: '', staySignedIn: true }))

vi.mock('electron', () => ({ app: { getPath: () => h.dir } }))
vi.mock('../resolvers/universal/capture', () => ({ browsingSession: vi.fn() }))
vi.mock('./settings', () => ({ getSettings: () => ({ browserStaySignedIn: h.staySignedIn }) }))
vi.mock('./secrets', () => ({ getSecret: vi.fn(), setSecret: vi.fn(), SECRET: {} }))
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('./ytdlp', () => ({ ytdlpBinaryPath: vi.fn(), ytdlpSpawnOptions: vi.fn() }))

const ENTRY = '.example.com\tTRUE\t/\tTRUE\t0\tsession\texample-value'
const HEADER = '# Netscape HTTP Cookie File\n'

beforeEach(() => {
  vi.resetModules()
  h.dir = mkdtempSync(join(tmpdir(), 'uvd-jar-'))
  h.staySignedIn = true
})

afterEach(() => rmSync(h.dir, { recursive: true, force: true }))

const logins = (): Promise<typeof import('./browser-logins')> => import('./browser-logins')
const jar = (text: string): void => writeFileSync(join(h.dir, 'browser-cookies.txt'), text)
const appJar = (): string => join(h.dir, 'browser-cookies.txt')

describe('the terminal reading the app’s jar', () => {
  it('hands over nothing until it is asked to read', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    const { browserCookiesFile } = await logins()
    expect(browserCookiesFile()).toBeUndefined()
  })

  it('hands over a jar with cookies in it', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    const copy = browserCookiesFile()!
    expect(readFileSync(copy, 'utf8')).toBe(`${HEADER}${ENTRY}\n`)
    dropSavedBrowserJar()
  })

  // The engine rewrites its --cookies file on the way out, with what it read at the start.
  it('hands over a copy, so the engine cannot put cookies back after a sign-out', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    const copy = browserCookiesFile()!
    expect(copy).not.toBe(appJar())
    expect(dirname(copy).startsWith(h.dir)).toBe(false)
    jar(HEADER) // Signed out in the window meanwhile.
    writeFileSync(copy, `${HEADER}${ENTRY}\n`) // The engine, exiting.
    expect(readFileSync(appJar(), 'utf8')).toBe(HEADER)
    dropSavedBrowserJar()
  })

  it.skipIf(process.platform === 'win32')('keeps the copy to its owner', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    expect(statSync(browserCookiesFile()!).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(browserCookiesFile()!)).mode & 0o777).toBe(0o700)
    dropSavedBrowserJar()
  })

  it('takes the copy away again and forgets it, however many times it is told', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    const copy = browserCookiesFile()!
    dropSavedBrowserJar()
    expect(existsSync(copy)).toBe(false)
    expect(existsSync(dirname(copy))).toBe(false)
    expect(browserCookiesFile()).toBeUndefined()
    expect(() => dropSavedBrowserJar()).not.toThrow()
    expect(existsSync(appJar())).toBe(true)
  })

  it('makes no copy of an empty jar', async () => {
    jar(HEADER)
    const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    expect(browserCookiesFile()).toBeUndefined()
    dropSavedBrowserJar()
  })

  it('does not take the blank lines of a rewritten jar for cookies', async () => {
    jar(`${HEADER}\r\n\r\n`)
    const { browserCookiesFile, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    expect(browserCookiesFile()).toBeUndefined()
  })

  it('hands over nothing when signing out left it empty, or it was never written', async () => {
    const empty = await logins()
    empty.readSavedBrowserJar()
    expect(empty.browserCookiesFile()).toBeUndefined()

    jar(HEADER)
    empty.readSavedBrowserJar()
    expect(empty.browserCookiesFile()).toBeUndefined()
  })

  it('hands over nothing with staying signed in switched off', async () => {
    jar(`${HEADER}${ENTRY}\n`)
    h.staySignedIn = false
    const { browserCookiesFile, readSavedBrowserJar } = await logins()
    readSavedBrowserJar()
    expect(browserCookiesFile()).toBeUndefined()
  })

  // Ctrl-C on Windows ends the process with no handler run, so the copy stays behind.
  describe('copies a run did not live to delete', () => {
    /** A process id nothing has: past anything Windows or Linux hands out. */
    const GONE = 0x7ffffff0
    const copy = (name: string, age = 0): string => {
      const dir = join(h.dir, name)
      mkdirSync(dir)
      writeFileSync(join(dir, 'cookies.txt'), ENTRY)
      const when = (Date.now() - age) / 1000
      utimesSync(dir, when, when)
      return dir
    }
    const DAY = 24 * 60 * 60 * 1000

    it('deletes the copy of a process that is gone', async () => {
      const left = copy(`uvd-cookies-${GONE}-aBc123`)
      await (await logins()).sweepAbandonedJars(h.dir)
      expect(existsSync(left)).toBe(false)
    })

    it('leaves the copy of a run still going', async () => {
      const running = copy(`uvd-cookies-${process.pid}-aBc123`)
      await (await logins()).sweepAbandonedJars(h.dir)
      expect(existsSync(running)).toBe(true)
    })

    it('gives a copy from before the process id a day', async () => {
      const recent = copy('uvd-cookies-aBc123')
      const old = copy('uvd-cookies-dEf456', 2 * DAY)
      await (await logins()).sweepAbandonedJars(h.dir)
      expect(existsSync(recent)).toBe(true)
      expect(existsSync(old)).toBe(false)
    })

    it('touches nothing else in the folder', async () => {
      const other = copy('uvd-jar-other', 2 * DAY)
      await (await logins()).sweepAbandonedJars(h.dir)
      expect(existsSync(other)).toBe(true)
    })

    it('puts its own process id on the copy it makes', async () => {
      jar(`${HEADER}${ENTRY}\n`)
      const { browserCookiesFile, dropSavedBrowserJar, readSavedBrowserJar } = await logins()
      readSavedBrowserJar()
      expect(basename(dirname(browserCookiesFile()!))).toMatch(new RegExp(`^uvd-cookies-${process.pid}-`))
      dropSavedBrowserJar()
    })
  })
})
