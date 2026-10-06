/**
 * What a Linux package of this app has to carry to start and to look like
 * itself, as plain checks over file names and file contents.
 *
 * Every one of these shipped wrong at some point, and nothing noticed, because
 * the developer's machine was fine each time:
 *
 *  - The .deb could not start on Ubuntu 24.04. Ubuntu only lets a program
 *    create user namespaces when an AppArmor profile allows it, Chromium's
 *    sandbox is built on them, and there was no profile. Refused, Chromium falls
 *    back to the setuid helper, finds it is not setuid, and aborts before any
 *    window appears.
 *  - The packages installed a single 1024px icon. The hicolor theme only looks
 *    in the sizes its index.theme lists, which stop at 512, so every launcher
 *    showed a generic placeholder. The smaller sizes existed only in a git-ignored
 *    folder on the machine that made them, so local builds looked right.
 *  - The desktop entry carried a literal `entry=[object Object]` line: the
 *    config was written for electron-builder 26, and 25 prints nested objects.
 *
 * Imported by scripts/after-pack.mjs (before any installer is built),
 * scripts/check-linux-packages.mjs (against the built .deb and .rpm in CI) and
 * scripts/generate-icons.mjs, so the three agree on one list of sizes.
 */

/**
 * The hicolor sizes we render and install: the usual fixed sizes index.theme
 * lists for apps, up to 512, the largest it has — anything bigger is never
 * looked up. 24 and 48 were missing even from the ignored local set.
 */
export const HICOLOR_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width and height from a PNG's header, or null for anything that is not one. */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * Why an icon directory would not give the theme what it looks for.
 *
 * `files` maps a file name to its contents. electron-builder installs each
 * `NxN.png` under hicolor/NxN, trusting the name — so a file whose pixels do
 * not match its name is drawn at the wrong scale, which is checked here too.
 */
export function iconProblems(files) {
  const problems = []
  for (const size of HICOLOR_SIZES) {
    const name = `${size}x${size}.png`
    const buf = files.get(name)
    if (!buf) {
      problems.push(`${name} is missing`)
      continue
    }
    const actual = pngSize(buf)
    if (!actual) problems.push(`${name} is not a PNG`)
    else if (actual.width !== size || actual.height !== size)
      problems.push(`${name} is really ${actual.width}x${actual.height}`)
  }
  return problems
}

/** The sizes found under usr/share/icons/hicolor in a package's file list. */
export function hicolorSizes(paths, iconName) {
  const sizes = new Set()
  const pattern = /(?:^|\/)usr\/share\/icons\/hicolor\/(\d+)x\1\/apps\/([^/]+)\.png$/
  for (const p of paths) {
    const m = pattern.exec(p)
    if (m && m[2] === iconName) sizes.add(Number(m[1]))
  }
  return [...sizes].sort((a, b) => a - b)
}

/**
 * Keys the Desktop Entry specification defines for the main group. Anything
 * else has to start with `X-`; desktop-file-validate, AppStream and the
 * software centres built on it reject the file otherwise.
 */
const DESKTOP_KEYS = new Set([
  'Type',
  'Version',
  'Name',
  'GenericName',
  'NoDisplay',
  'Comment',
  'Icon',
  'Hidden',
  'OnlyShowIn',
  'NotShowIn',
  'DBusActivatable',
  'TryExec',
  'Exec',
  'Path',
  'Terminal',
  'Actions',
  'MimeType',
  'Categories',
  'Implements',
  'Keywords',
  'StartupNotify',
  'StartupWMClass',
  'URL',
  'PrefersNonDefaultGPU',
  'SingleMainWindow'
])

/** The `[Desktop Entry]` group as key → value; localised keys keep their `[xx]`. */
export function parseDesktopEntry(text) {
  const entries = new Map()
  let inMain = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inMain = line === '[Desktop Entry]'
      continue
    }
    const eq = line.indexOf('=')
    if (inMain && eq > 0) entries.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  return entries
}

/**
 * What is wrong with a desktop entry for this app, as sentences.
 *
 * Not a validator — desktop-file-validate is, and CI runs it. These are the
 * mistakes this app has actually shipped, checked anywhere node runs.
 * `StartupWMClass` has to be the app's own name: that is the window class
 * Electron gives the window, and the dock matches windows to launchers by it.
 * Get it wrong and every window opens a second, unpinnable dock icon.
 */
export function desktopEntryProblems(text, executable) {
  const entry = parseDesktopEntry(text)
  const problems = []
  if (!text.split(/\r?\n/).some((l) => l.trim() === '[Desktop Entry]'))
    problems.push('there is no [Desktop Entry] group')
  for (const [key, value] of entry) {
    const bare = key.replace(/\[[^\]]*\]$/, '')
    if (!DESKTOP_KEYS.has(bare) && !bare.startsWith('X-'))
      problems.push(`"${key}" is not a desktop entry key`)
    if (value.includes('[object Object]'))
      problems.push(`"${key}" holds a printed JavaScript object`)
  }
  for (const key of ['Type', 'Name', 'Exec']) {
    if (!entry.get(key)) problems.push(`${key} is missing`)
  }
  if (entry.get('Icon') !== executable)
    problems.push(`Icon is "${entry.get('Icon') ?? ''}", not "${executable}"`)
  if (entry.get('StartupWMClass') !== executable)
    problems.push(`StartupWMClass is "${entry.get('StartupWMClass') ?? ''}", not "${executable}"`)
  const categories = entry.get('Categories') ?? ''
  if (!categories.endsWith(';')) problems.push('Categories does not end with ";"')
  if (!categories.split(';').includes('AudioVideo'))
    problems.push('Categories leaves out AudioVideo, so the app is filed under Other')
  return problems
}

/**
 * The name and attach path of the profile an AppArmor file declares.
 *
 * The attach path is what matters: AppArmor applies a profile to the program
 * at exactly that path, so one that names a path the package does not install
 * attaches to nothing, and the app aborts exactly as if there were no profile.
 */
export function apparmorProfileTarget(text) {
  const m = /^\s*profile\s+("[^"]+"|\S+)\s+("[^"]+"|\S+)/m.exec(text)
  if (!m) return null
  const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s)
  return { name: unquote(m[1]), attach: unquote(m[2]) }
}

/** Why a profile would not apply to the executable installed at `installed`, or null. */
export function profileProblem(text, installed, executable) {
  const profile = apparmorProfileTarget(text)
  if (!profile) return 'the AppArmor profile declares no profile'
  if (profile.name === executable && profile.attach === installed) return null
  return (
    `the AppArmor profile is "${profile.name}" for ${profile.attach}, ` +
    `but the package installs ${installed}`
  )
}

/**
 * The macros electron-builder 25 fills in an afterInstall/afterRemove script.
 *
 * FpmTarget replaces every dollar-brace name made only of letters and throws on
 * any it does not know, which turns an innocent braced shell variable into a
 * failed release build. So the scripts only ever use these.
 */
export const SCRIPT_MACROS = ['executable', 'sanitizedProductName', 'productFilename']

/** Macro names a script uses that electron-builder would refuse. */
export function unknownMacros(text) {
  const used = [...text.matchAll(/\$\{([a-zA-Z]+)\}/g)].map((m) => m[1])
  return [...new Set(used.filter((name) => !SCRIPT_MACROS.includes(name)))]
}

/** A script with the macros filled in, the way FpmTarget does it. */
export function fillMacros(text, values) {
  return text.replace(/\$\{([a-zA-Z]+)\}/g, (match, name) => {
    if (!(name in values)) throw new Error(`Macro ${name} is not defined`)
    return values[name]
  })
}

/**
 * The executable and product directory a built package's file list implies.
 *
 * electron-builder names the desktop entry after the executable and installs
 * the app under /opt/<product>. Taken from the package rather than the config,
 * so a disagreement between the two is exactly what a check built on this
 * catches. Paths may come with a leading slash (`rpm -ql`) or without (an
 * extracted .deb).
 */
export function packageLayout(paths) {
  const first = (re) => paths.map((p) => re.exec(p)?.[1]).find(Boolean)
  return {
    executable: first(/^\/?usr\/share\/applications\/([^/]+)\.desktop$/),
    product: first(/^\/?opt\/([^/]+)\//)
  }
}

/** What a built package's file list is missing; the same for a .deb and an .rpm. */
export function layoutProblems(paths) {
  const { executable, product } = packageLayout(paths)
  if (!executable) return ['there is no desktop entry in /usr/share/applications']
  if (!product) return ['nothing is installed under /opt']
  const problems = []
  const listed = new Set(paths.map((p) => p.replace(/^\//, '')))
  for (const file of [executable, 'chrome-sandbox', 'resources/apparmor-profile', 'resources/bin/uvd']) {
    if (!listed.has(`opt/${product}/${file}`)) problems.push(`/opt/${product}/${file} is missing`)
  }
  const sizes = hicolorSizes(paths, executable)
  const missing = HICOLOR_SIZES.filter((s) => !sizes.includes(s))
  if (missing.length > 0)
    problems.push(`hicolor has ${sizes.join(', ') || 'no sizes'}; missing ${missing.join(', ')}`)
  return problems
}

/**
 * What a built package's install and remove scripts fail to do.
 *
 * The remove script has to leave upgrades alone: rpm runs the old package's
 * %postun after the new one's %post, so one that always cleans up deletes the
 * profile the upgrade just installed, and the app aborts again after a reboot.
 */
export function scriptProblems(postinst, postrm, executable) {
  const problems = []
  if (!postinst.includes('apparmor_parser --replace'))
    problems.push('the install script never loads an AppArmor profile')
  if (!postinst.includes(`/etc/apparmor.d/${executable}`))
    problems.push(`the install script does not install /etc/apparmor.d/${executable}`)
  if (/\$\{[a-zA-Z]+\}/.test(postinst + postrm))
    problems.push('a script still holds an unfilled macro')
  if (!postrm.includes('remove|purge|0)'))
    problems.push('the remove script does not leave upgrades alone')
  // `uvd <link>` in a terminal: build/uvd, linked onto the PATH by the install script.
  if (!/ln -sf '[^']*\/resources\/bin\/uvd' '\/usr\/bin\/uvd'/.test(postinst))
    problems.push('the install script does not put uvd on the PATH')
  if (!postrm.includes('/usr/bin/uvd')) problems.push('the remove script leaves /usr/bin/uvd behind')
  return problems
}

/** `rpm -qp --scripts` output split into scriptlets, by the name in each heading. */
export function rpmScriptlets(text) {
  const lines = {}
  let current = null
  for (const line of text.split('\n')) {
    const head = /^(\w+) scriptlet/.exec(line)
    if (head) current = lines[head[1]] = []
    else if (current) current.push(line)
  }
  return Object.fromEntries(Object.entries(lines).map(([name, body]) => [name, body.join('\n')]))
}
