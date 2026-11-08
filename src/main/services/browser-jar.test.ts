import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
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
})
