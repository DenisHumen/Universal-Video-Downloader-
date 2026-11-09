import { readFileSync } from 'fs'
import { runInNewContext } from 'vm'
import { inflateRawSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'
import { linkFromSentUrl } from '../src/shared/sent-link'
import { pngSize } from './linux-package.mjs'
import { extensionProblems, manifestFor, readExtension, zip } from './package-extension.mjs'

const DIR = 'browser-extension'
const files = readExtension(DIR)
const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'))
const withManifest = (patch: object): Map<string, Buffer> =>
  new Map(files).set('manifest.json', Buffer.from(JSON.stringify({ ...manifest, ...patch })))

describe('what the extension asks for', () => {
  it('is nothing more than it says', () => {
    expect(extensionProblems(files)).toEqual([])
  })

  it.each([
    ['another permission', { permissions: ['activeTab', 'contextMenus', 'tabs'] }, 'it asks for activeTab, contextMenus, tabs, not activeTab, contextMenus'],
    ['host permissions', { host_permissions: ['<all_urls>'] }, 'it declares host_permissions'],
    ['content scripts', { content_scripts: [{ matches: ['<all_urls>'], js: ['link.js'] }] }, 'it declares content_scripts'],
    ['Manifest V2', { manifest_version: 2 }, 'it is not Manifest V3'],
    ['no id for Firefox', { browser_specific_settings: {} }, 'Firefox has no add-on id']
  ])('fails on %s', (_name, patch, problem) => {
    expect(extensionProblems(withManifest(patch))).toContain(problem)
  })

  it('fails on anything that talks to the network, and on words missing from a language', () => {
    const fetching = new Map(files).set('popup.js', Buffer.from(`${files.get('popup.js')}\nfetch('https://example.com/stats')`))
    expect(extensionProblems(fetching)).toContain('popup.js looks like it talks to the network')
    const ru = JSON.parse(files.get('_locales/ru/messages.json')!.toString('utf8'))
    delete ru.popupSent
    const short = new Map(files).set('_locales/ru/messages.json', Buffer.from(JSON.stringify(ru)))
    expect(extensionProblems(short)).toContain('the two languages have different messages')
  })

  it('has its icon at the sizes the manifest names', () => {
    for (const [size, path] of Object.entries(manifest.icons as Record<string, string>)) {
      expect(pngSize(files.get(path)!)).toEqual({ width: Number(size), height: Number(size) })
    }
  })

  it('does not end up inside the app', () => {
    expect(readFileSync('electron-builder.yml', 'utf-8')).toContain("'!browser-extension{,/**/*}'")
  })
})

describe('what each store gets', () => {
  it('is a manifest with only its own background', () => {
    const chromium = manifestFor(manifest, 'chromium')
    expect(chromium.background).toEqual({ service_worker: 'background.js' })
    expect(chromium).not.toHaveProperty('browser_specific_settings')
    const firefox = manifestFor(manifest, 'firefox')
    expect(firefox.background).toEqual({ scripts: ['link.js', 'background.js'] })
    expect(firefox).toHaveProperty('browser_specific_settings.gecko.id')
  })

  it('is a zip that holds what went in, the same every time', () => {
    const packed = zip(new Map([['a/b.txt', Buffer.from('hello hello hello')]]))
    expect(packed.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04')
    const nameLength = packed.readUInt16LE(26)
    expect(packed.toString('utf8', 30, 30 + nameLength)).toBe('a/b.txt')
    const size = packed.readUInt32LE(18)
    expect(inflateRawSync(packed.subarray(30 + nameLength, 30 + nameLength + size)).toString()).toBe('hello hello hello')
    expect(zip(new Map([['a/b.txt', Buffer.from('hello hello hello')]])).equals(packed)).toBe(true)
  })
})

/** The extension's own scripts, run against a pretend browser. */
function load(names: string[], globals: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = { Promise, ...globals }
  context.globalThis = context
  for (const name of names) runInNewContext(files.get(name)!.toString('utf8'), context, { filename: name })
  return context
}

const fakeApi = (tab?: { id?: number; url?: string }) => ({
  tabs: {
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    query: vi.fn(async () => (tab ? [tab] : []))
  },
  i18n: { getMessage: (key: string) => key },
  runtime: { onInstalled: { addListener: vi.fn() } },
  contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } }
})

describe('what the extension sends', () => {
  const send = async (url: string): Promise<string> => {
    const api = fakeApi()
    const page = load(['link.js'], {}) as { openInApp: (a: unknown, t: number, u: string) => Promise<boolean> }
    expect(await page.openInApp(api, 7, url)).toBe(true)
    const calls = api.tabs.update.mock.calls as unknown as [number, { url: string }][]
    expect(calls[0][0]).toBe(7)
    return calls[0][1].url
  }

  it.each([
    ['https://example.com/watch?v=1&t=2#x'],
    ['http://192.168.1.10/a b'.replace(' ', '%20')],
    ['https://example.com/?q=a+b&r=%D1%8F']
  ])('is what the app reads back as the same link: %s', async (url) => {
    expect(linkFromSentUrl(await send(url))).toBe(url)
  })

  it('is nothing for a page with no web address', async () => {
    const page = load(['link.js'], {}) as { openInApp: (a: unknown, t: number, u: unknown) => Promise<boolean> }
    const api = fakeApi()
    for (const url of ['chrome://extensions', 'about:addons', 'file:///etc/passwd', 'javascript:alert(1)', '', undefined, `https://a.example/${'a'.repeat(4096)}`]) {
      expect(await page.openInApp(api, 1, url)).toBe(false)
    }
    expect(api.tabs.update).not.toHaveBeenCalled()
  })

  it('finds a new tab when the menu came from somewhere that has none', async () => {
    const page = load(['link.js'], {}) as { openInApp: (a: unknown, t: number | undefined, u: string) => Promise<boolean> }
    const api = fakeApi()
    await page.openInApp(api, undefined, 'https://example.com/')
    await page.openInApp(api, -1, 'https://example.com/')
    expect(api.tabs.create).toHaveBeenCalledTimes(2)
  })

  it('adds its menu item on links only, and sends the link it was opened on', async () => {
    const api = fakeApi()
    load(['link.js', 'background.js'], { chrome: api })
    ;(api.runtime.onInstalled.addListener.mock.calls as unknown as [() => void][])[0][0]()
    expect(api.contextMenus.create).toHaveBeenCalledWith({ id: 'send-link', title: 'menuSendLink', contexts: ['link'] })
    const clicked = (api.contextMenus.onClicked.addListener.mock.calls as unknown as [(i: object, t: object) => void][])[0][0]
    clicked({ menuItemId: 'send-link', linkUrl: 'https://example.com/v' }, { id: 3 })
    expect(api.tabs.update).toHaveBeenCalledWith(3, { url: `uvd://open?url=${encodeURIComponent('https://example.com/v')}` })
  })

  it('loads link.js by itself only where importScripts exists: a Chromium worker, not a Firefox page', () => {
    const importScripts = vi.fn(() => undefined)
    const worker = { chrome: fakeApi(), importScripts, openInApp: vi.fn() }
    load(['background.js'], worker)
    expect(importScripts).toHaveBeenCalledWith('link.js')
  })

  it('tells the popup what happened, and what no answer means', async () => {
    const text: Record<string, string> = {}
    const document = { getElementById: (id: string) => ({ set textContent(v: string) { text[id] = v } }) }
    load(['link.js', 'popup.js'], { document, browser: fakeApi({ id: 1, url: 'https://example.com/' }) })
    await vi.waitFor(() => expect(text).toEqual({ status: 'popupSent', help: 'popupNoApp' }))

    const quiet: Record<string, string> = {}
    const page = { getElementById: (id: string) => ({ set textContent(v: string) { quiet[id] = v } }) }
    load(['link.js', 'popup.js'], { document: page, browser: fakeApi({ id: 1, url: 'about:addons' }) })
    await vi.waitFor(() => expect(quiet).toEqual({ status: 'popupNotAPage' }))
  })

  it('is plain JavaScript that reads nothing from the page', () => {
    for (const [path, body] of files) {
      if (path.endsWith('.js')) expect(body.toString('utf8'), path).not.toMatch(/executeScript|document\.cookie|\bimport\s/)
    }
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(DIR).toBe('browser-extension')
  })
})
