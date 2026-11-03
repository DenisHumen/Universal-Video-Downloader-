import { execFileSync } from 'child_process'
import { readFileSync, statSync } from 'fs'
import { describe, expect, it } from 'vitest'

/*
 * What a Mac user is told to do when Gatekeeper stops the app, in the four
 * places they might read it: the README, the release notes, the install
 * window's background and the notice inside the app.
 *
 * They had drifted apart. The release notes said `xattr -cr`, which strips
 * every extended attribute from every file in the bundle, while the other
 * three said `xattr -dr com.apple.quarantine`. The README and the install
 * window also offered right-click → Open → Open, which never gets past
 * "damaged" (what an Apple silicon Mac says) and which macOS 15 removed.
 */

const lf = (s: string): string => s.replace(/\r\n/g, '\n')
const read = (path: string): string => lf(readFileSync(path, 'utf-8'))

const builderYml = read('electron-builder.yml')
const productName = /^productName:\s*(.+?)\s*$/m.exec(builderYml)?.[1] ?? ''
const COMMAND = `xattr -dr com.apple.quarantine "/Applications/${productName}.app"`

/** The README's macOS section, up to the next heading of the same level. */
function readmeMacSection(): string {
  const readme = read('README.md')
  const start = readme.indexOf('### macOS')
  const end = readme.indexOf('\n### ', start + 1)
  return start === -1 ? '' : readme.slice(start, end === -1 ? undefined : end)
}

/** What the release job writes into the notes: its `echo` lines, nothing it says to itself. */
function releaseNotes(): string {
  return read('.github/workflows/release.yml')
    .split('\n')
    .filter((line) => /^\s*echo\b/.test(line))
    .join('\n')
}

/** The words drawn on the DMG background, without the comments around them. */
function dmgText(): string {
  const svg = read('assets/dmg-background.svg')
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('\n')
}

/** MacNotice's copy: the command it shows and copies, and its strings in both languages. */
function macNotice(): string {
  const source = read('src/renderer/src/components/MacNotice.tsx')
  const strings = ['en', 'ru'].flatMap((lang) =>
    [...read(`src/renderer/src/i18n/${lang}.ts`).matchAll(/'mac\.\w+':\s*'([^']*)'/g)].map(
      (m) => m[1]
    )
  )
  const command = /const COMMAND = '([^']*)'/.exec(source)?.[1] ?? ''
  return [command, ...strings].join('\n')
}

const SCRIPT = 'build/mac/Fix App Is Damaged.command'
const GUIDE = 'build/mac/How to open on macOS.pdf'

const PLACES: [string, () => string][] = [
  // The DMG's double-clickable fix and the generator of its PDF guide (the PDF is built from it).
  ['the fix script', () => read(SCRIPT)],
  ['the PDF guide', () => {
    const src = read('scripts/generate-mac-guide.mjs')
    // The generator builds the command from the product name; check what it renders.
    return src.replace(/\$\{productName\}/g, productName)
  }],
  ['the README', readmeMacSection],
  ['the release notes', releaseNotes],
  ['the DMG background', dmgText],
  ['MacNotice', macNotice]
]

/** Every xattr invocation in a text, as written. */
const xattrCommands = (text: string): string[] =>
  [...text.matchAll(/xattr\s+-[^\n'`<]*/g)].map((m) => m[0].trim())

describe('the macOS instructions', () => {
  it('know the product name the app is installed under', () => {
    expect(productName).toBe('Universal Video Downloader')
  })

  // `xattr -cr` in the release notes against `-dr com.apple.quarantine` everywhere else.
  it.each(PLACES)('give %s the one xattr command, exactly', (_place, text) => {
    const commands = xattrCommands(text())
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) expect(command).toBe(COMMAND)
  })

  // Right-click → Open → Open does nothing for "damaged", and macOS 15 took it away.
  it.each(PLACES)('do not send %s to right-click → Open', (_place, text) => {
    expect(text()).not.toMatch(/right[- ]click|control[- ]click|ctrl[- ]click|правой кнопкой/i)
  })

  // The checks above would pass on an empty section, so make sure each one was found.
  it('find the macOS part of every place they check', () => {
    expect(readmeMacSection()).toContain('damaged')
    expect(releaseNotes()).toContain('### If macOS says the app is damaged')
    expect(dmgText()).toContain('damaged')
    expect(macNotice().split('\n')).toHaveLength(5)
  })
})

describe('the DMG extras (fix script and PDF guide)', () => {
  it('ships the script executable, with LF line endings, under an ASCII name', () => {
    /*
      The mode git records is what the DMG build checks out, on every runner.
      The working tree's own mode depends on the umask (0o775 under 002) and
      means nothing on Windows, so it is only checked for the owner's x bit,
      and not at all on win32.
    */
    const staged = execFileSync('git', ['ls-files', '-s', '--', SCRIPT], { encoding: 'utf-8' })
    if (staged.trim()) expect(staged.split(/\s+/)[0]).toBe('100755')
    if (process.platform !== 'win32') expect(statSync(SCRIPT).mode & 0o100).toBe(0o100)
    expect(readFileSync(SCRIPT, 'utf-8')).not.toContain('\r')
    expect(SCRIPT).toMatch(/^[\x20-\x7e]+$/)
    expect(read('.gitattributes')).toMatch(/^\*\.command text eol=lf$/m)
  })

  it('never strips every attribute, and checks the app is in Applications first', () => {
    const script = read(SCRIPT)
    expect(script).not.toMatch(/xattr\s+-c/)
    expect(script).toMatch(/\[ ! -d "\$APP" \]/)
    expect(script).toMatch(/open -a "\$APP"/)
  })

  it('puts both into the install window, and the PDF exists', () => {
    expect(builderYml).toContain(`path: ${SCRIPT}`)
    expect(builderYml).toContain(`path: ${GUIDE}`)
    expect(statSync(GUIDE).size).toBeGreaterThan(10_000)
  })

  it('tells the release notes about them', () => {
    expect(releaseNotes()).toMatch(/Fix App Is Damaged\.command/)
    expect(releaseNotes()).toMatch(/How to open on macOS\.pdf/)
  })
})
