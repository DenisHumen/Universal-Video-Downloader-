import { describe, expect, it } from 'vitest'
import { isRendererDocument, navigationVerdict, type RendererLocation } from './navigation-rules'

/*
  The old rule let a window go to any `file://` URL. Dropping a saved HTML page
  onto Settings, Downloads or Automation loaded it in place of the app, and it
  got the whole preload bridge: `shell.openPath`, settings writes, the queue.
*/

const WINDOWS: RendererLocation = {
  indexPath: 'C:\\Program Files\\UVD\\resources\\app.asar\\out\\renderer\\index.html',
  platform: 'win32'
}
const WIN_DOC = 'file:///C:/Program%20Files/UVD/resources/app.asar/out/renderer/index.html'

const LINUX: RendererLocation = {
  indexPath: '/opt/UVD/resources/app.asar/out/renderer/index.html',
  platform: 'linux'
}
const LINUX_DOC = 'file:///opt/UVD/resources/app.asar/out/renderer/index.html'

const DEV: RendererLocation = { ...WINDOWS, devUrl: 'http://localhost:5173' }

describe('navigationVerdict', () => {
  it('refuses another local file, the dropped-HTML case', () => {
    expect(navigationVerdict('file:///C:/Users/me/Downloads/page.html', WIN_DOC, WINDOWS)).toBe('block')
    expect(navigationVerdict('file:///home/me/page.html', LINUX_DOC, LINUX)).toBe('block')
  })

  it('refuses a file sitting next to the app as well', () => {
    const sibling = 'file:///C:/Program%20Files/UVD/resources/app.asar/out/renderer/evil.html'
    expect(navigationVerdict(sibling, WIN_DOC, WINDOWS)).toBe('block')
  })

  it('lets the window reload its own document, whichever shell the hash names', () => {
    expect(navigationVerdict(`${WIN_DOC}#/search?q=cats`, `${WIN_DOC}#/search?q=dogs`, WINDOWS)).toBe(
      'allow'
    )
    expect(navigationVerdict(`${LINUX_DOC}#/browser`, LINUX_DOC, LINUX)).toBe('allow')
  })

  it('sends web links to a browser instead of loading them over the bridge', () => {
    expect(navigationVerdict('https://example.com/watch', WIN_DOC, WINDOWS)).toBe('external')
    expect(navigationVerdict('HTTP://example.com/', LINUX_DOC, LINUX)).toBe('external')
  })

  it('refuses the schemes a page could smuggle in', () => {
    for (const target of ['javascript:alert(1)', 'data:text/html,<p>hi</p>', 'blob:null/1234', 'about:blank']) {
      expect(navigationVerdict(target, WIN_DOC, WINDOWS), target).toBe('block')
    }
  })

  it('allows the dev server, and only by origin', () => {
    expect(navigationVerdict('http://localhost:5173/#/search', 'http://localhost:5173/', DEV)).toBe('allow')
    // A prefix test would have let a different port through.
    expect(navigationVerdict('http://localhost:51730/', 'http://localhost:5173/', DEV)).toBe('external')
    expect(navigationVerdict(WIN_DOC, 'http://localhost:5173/', DEV)).toBe('block')
  })
})

describe('isRendererDocument', () => {
  it('matches the install path whatever its case or encoding on Windows', () => {
    const shouting = 'file:///c:/PROGRAM%20FILES/uvd/resources/app.asar/out/renderer/INDEX.html#/'
    expect(isRendererDocument(shouting, WINDOWS)).toBe(true)
    const cyrillic: RendererLocation = {
      indexPath: 'C:\\Users\\Денис\\AppData\\Local\\Programs\\UVD\\resources\\app.asar\\out\\renderer\\index.html',
      platform: 'win32'
    }
    const encoded =
      'file:///C:/Users/%D0%94%D0%B5%D0%BD%D0%B8%D1%81/AppData/Local/Programs/UVD/resources/app.asar/out/renderer/index.html#/browser'
    expect(isRendererDocument(encoded, cyrillic)).toBe(true)
  })

  it('is case-sensitive where the file system is', () => {
    expect(isRendererDocument(LINUX_DOC.replace('index', 'INDEX'), LINUX)).toBe(false)
    expect(isRendererDocument(LINUX_DOC, LINUX)).toBe(true)
  })

  it('compares the file a URL points at, not how the URL spells it', () => {
    const climbing = 'file:///opt/UVD/resources/app.asar/out/main/../renderer/index.html'
    expect(isRendererDocument(climbing, LINUX)).toBe(true)
    const escaping = 'file:///opt/UVD/resources/app.asar/out/renderer/../../../index.html'
    expect(isRendererDocument(escaping, LINUX)).toBe(false)
  })

  it('answers no to anything that is not a file, or is not a URL at all', () => {
    expect(isRendererDocument('https://example.com/index.html', WINDOWS)).toBe(false)
    expect(isRendererDocument('not a url', WINDOWS)).toBe(false)
    expect(isRendererDocument('', LINUX)).toBe(false)
  })

  it('in development, accepts the dev server and nothing on disk', () => {
    expect(isRendererDocument('http://localhost:5173/#/browser', DEV)).toBe(true)
    expect(isRendererDocument(WIN_DOC, DEV)).toBe(false)
  })
})
