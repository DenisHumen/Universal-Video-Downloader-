/**
 * Check browser-extension/ and zip it, once for Chromium and once for Firefox.
 *
 *   node scripts/package-extension.mjs           # release/extension/*.zip
 *   node scripts/package-extension.mjs --check   # the checks alone, as CI runs them
 *
 * One folder loads unpacked in both, which is why its manifest names a background
 * two ways. A store wants only its own: Chromium's warns about Firefox's keys, and
 * Firefox has no service workers for extensions. The checks are what the extension
 * promises in its README, so that a permission cannot arrive unnoticed. Only
 * Node's own modules, so that running this installs nothing.
 */
import { crc32, deflateRawSync } from 'zlib'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

/** Exactly these; adding one is a decision for this list and the README, and a store review. */
export const ALLOWED_PERMISSIONS = ['activeTab', 'contextMenus']

const REMOTE_CODE = /\b(?:eval|importScripts)\s*\(\s*['"`]?https?:|<script[^>]+src\s*=\s*['"]https?:|\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+Function\b/i

/**
 * What is wrong with the extension, in words; empty when nothing is.
 *
 * @param {Map<string, Buffer>} files every file, by its path with forward slashes
 * @returns {string[]}
 */
export function extensionProblems(files) {
  const text = (path) => files.get(path)?.toString('utf8')
  const source = text('manifest.json')
  if (!source) return ['there is no manifest.json']
  const manifest = JSON.parse(source)
  const problems = []

  if (manifest.manifest_version !== 3) problems.push('it is not Manifest V3')
  const permissions = [...(manifest.permissions ?? [])].sort()
  if (permissions.join() !== [...ALLOWED_PERMISSIONS].sort().join())
    problems.push(`it asks for ${permissions.join(', ') || 'nothing'}, not ${ALLOWED_PERMISSIONS.join(', ')}`)
  for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources', 'content_security_policy', 'update_url'])
    if (key in manifest) problems.push(`it declares ${key}`)

  if (manifest.background?.service_worker !== 'background.js') problems.push('Chromium has no service worker')
  if (!manifest.background?.scripts?.includes('background.js')) problems.push('Firefox has no event page')
  if (!manifest.browser_specific_settings?.gecko?.id) problems.push('Firefox has no add-on id')

  const named = [
    manifest.action?.default_popup,
    ...(manifest.background?.scripts ?? []),
    manifest.background?.service_worker,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {})
  ]
  for (const path of named) if (path && !files.has(path)) problems.push(`${path} is named and missing`)

  // Every word in both languages, and everything asked for by name is really there.
  const locale = (lang) => {
    const body = text(`_locales/${lang}/messages.json`)
    return body ? JSON.parse(body) : null
  }
  const [en, ru] = [locale('en'), locale('ru')]
  if (!en || !ru) return [...problems, 'it does not come in both English and Russian']
  if (Object.keys(en).sort().join() !== Object.keys(ru).sort().join()) problems.push('the two languages have different messages')
  const code = [...files].filter(([path]) => /\.(js|html)$/.test(path)).map(([path, body]) => [path, body.toString('utf8')])
  const asked = [...source.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1])
  for (const [, body] of code) asked.push(...[...body.matchAll(/'((?:popup|menu)[A-Z]\w*)'/g)].map((m) => m[1]))
  for (const key of asked) if (!en[key]) problems.push(`the message ${key} is missing`)
  for (const key of Object.keys(en)) if (!asked.includes(key)) problems.push(`nothing uses the message ${key}`)

  for (const [path, body] of code) if (REMOTE_CODE.test(body)) problems.push(`${path} looks like it talks to the network`)
  return problems
}

/** The manifest a store gets. */
export function manifestFor(manifest, browser) {
  const { background, browser_specific_settings: gecko, ...rest } = manifest
  return browser === 'firefox'
    ? { ...rest, background: { scripts: background.scripts }, browser_specific_settings: gecko }
    : { ...rest, background: { service_worker: background.service_worker } }
}

/** A plain zip, deflated. The fixed date makes the same source the same file. */
export function zip(files) {
  const FIXED_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
  const locals = []
  const centrals = []
  let offset = 0
  for (const [path, body] of files) {
    const name = Buffer.from(path, 'utf8')
    const data = deflateRawSync(body, { level: 9 })
    const head = Buffer.alloc(26)
    head.writeUInt16LE(20, 0) // version needed
    head.writeUInt16LE(0x0800, 2) // UTF-8 names
    head.writeUInt16LE(8, 4) // deflate
    head.writeUInt16LE(0, 6) // time
    head.writeUInt16LE(FIXED_DATE, 8)
    head.writeUInt32LE(crc32(body), 10)
    head.writeUInt32LE(data.length, 14)
    head.writeUInt32LE(body.length, 18)
    head.writeUInt16LE(name.length, 22)
    head.writeUInt16LE(0, 24) // extra
    const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    locals.push(signature, head, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    head.copy(central, 6)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += signature.length + head.length + name.length + data.length
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

/** Every file that ships, by its path inside the extension. The README is for people reading the repository. */
export function readExtension(dir) {
  const files = new Map()
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name !== 'README.md') files.set(relative(dir, full).split(sep).join('/'), readFileSync(full))
    }
  }
  walk(dir)
  return files
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = readExtension(join(root, 'browser-extension'))
  const problems = extensionProblems(files)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`browser-extension: ${problem}`)
    process.exit(1)
  }
  if (process.argv.includes('--check')) {
    console.log(`browser-extension: ${files.size} files, nothing wrong`)
  } else {
    const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
    const out = join(root, 'release', 'extension')
    mkdirSync(out, { recursive: true })
    for (const browser of ['chromium', 'firefox']) {
      const own = new Map(files)
      own.set('manifest.json', Buffer.from(`${JSON.stringify(manifestFor(manifest, browser), null, 2)}\n`))
      const path = join(out, `send-to-uvd-${browser}-${manifest.version}.zip`)
      writeFileSync(path, zip(own))
      console.log(path)
    }
  }
}
