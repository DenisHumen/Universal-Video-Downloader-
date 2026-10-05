import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeRelease } from './finalize-release.mjs'
import {
  PRODUCT,
  installersIn,
  mergeMacUpdateInfo,
  missingAssets,
  parseUpdateInfo,
  releaseBinaries,
  sha256sums,
  updateInfoProblems
} from './release-assets.mjs'

const lf = (s: string): string => s.replace(/\r\n/g, '\n')
const version = (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version
const builderYml = lf(readFileSync('electron-builder.yml', 'utf-8'))
const releaseYml = lf(readFileSync('.github/workflows/release.yml', 'utf-8'))
const ciYml = lf(readFileSync('.github/workflows/ci.yml', 'utf-8'))

/** v3.20.0's latest-mac.yml as it is on the release: the Intel runner's, alone. */
const X64_MAC = `version: 3.20.0
files:
  - url: Universal-Video-Downloader-3.20.0-mac-x64.zip
    sha512: cbcCFYKD0rTwztYPeBbXQ7wYjrmVe9BLcv8XHD54XV2M41EEyPwJZl9loWYZ3lW1jwBbc48UzRp6h/Pji/umrQ==
    size: 134989600
  - url: Universal-Video-Downloader-3.20.0-mac-x64.dmg
    sha512: 9GPVSxGWQ+pJnJkyDIkSimw2mHvuThYMJ7GLTa4Xkwcgt3Gh04iTqGGxZ9+ZMrtfNqskxfMGxsrYHiE5EFxCZQ==
    size: 139871730
path: Universal-Video-Downloader-3.20.0-mac-x64.zip
sha512: cbcCFYKD0rTwztYPeBbXQ7wYjrmVe9BLcv8XHD54XV2M41EEyPwJZl9loWYZ3lW1jwBbc48UzRp6h/Pji/umrQ==
releaseDate: '2026-09-25T15:11:19.237Z'
`

/** What the Apple silicon runner wrote and then lost to the Intel one. */
const ARM64_MAC = X64_MAC.replace(/mac-x64/g, 'mac-arm64')
  .replace('size: 134989600', 'size: 131022451')
  .replace("releaseDate: '2026-09-25T15:11:19.237Z'", "releaseDate: '2026-09-25T15:09:02.511Z'")

/** v3.20.0's latest-linux.yml, which has a blockMapSize the others lack. */
const LINUX = `version: 3.20.0
files:
  - url: Universal-Video-Downloader-3.20.0-linux-x86_64.AppImage
    sha512: u+H8lfLdBF9fInJmqDu9bSRrRfjzrjJ2AvHYeOn3Zv9ClpAQ5k1fQeAe6Ce79S9pmdLx0d339SKXCpC3boMvaQ==
    size: 144539415
    blockMapSize: 151339
  - url: Universal-Video-Downloader-3.20.0-linux-amd64.deb
    sha512: RuFTpQGv6ryOh+/a7ZTXqFWtsE44r4ufAFsU75rrE068ZgFoosIKIByiT3xTsJxAeMmFsX1RdedwOttcvcLWcA==
    size: 101064556
path: Universal-Video-Downloader-3.20.0-linux-x86_64.AppImage
sha512: u+H8lfLdBF9fInJmqDu9bSRrRfjzrjJ2AvHYeOn3Zv9ClpAQ5k1fQeAe6Ce79S9pmdLx0d339SKXCpC3boMvaQ==
releaseDate: '2026-09-25T15:12:08.400Z'
`

/** The 16 assets on the v3.20.0 release, blockmaps and GitHub's renamed ones included. */
const V3_20_0_ASSETS = [
  'latest-linux.yml',
  'latest-mac.yml',
  'latest.yml',
  'Universal-Video-Downloader-3.20.0-linux-amd64.deb',
  'Universal-Video-Downloader-3.20.0-linux-x86_64.AppImage',
  'Universal-Video-Downloader-3.20.0-linux-x86_64.rpm',
  'Universal-Video-Downloader-3.20.0-mac-arm64.dmg',
  'Universal-Video-Downloader-3.20.0-mac-arm64.dmg.blockmap',
  'Universal-Video-Downloader-3.20.0-mac-arm64.zip',
  'Universal-Video-Downloader-3.20.0-mac-x64.dmg',
  'Universal-Video-Downloader-3.20.0-mac-x64.dmg.blockmap',
  'Universal-Video-Downloader-3.20.0-mac-x64.zip',
  'Universal-Video-Downloader-3.20.0-windows-x64-setup.exe',
  'Universal-Video-Downloader-3.20.0-windows-x64-setup.exe.blockmap',
  'Universal.Video.Downloader-3.20.0-mac-arm64.zip.blockmap',
  'Universal.Video.Downloader-3.20.0-mac-x64.zip.blockmap'
]

/**
 * The zip electron-updater's MacUpdater would download: filterFilesForArch
 * keeps the files with "arm64" in the url on an Apple silicon Mac (when there
 * are any) and drops them on an Intel one, then findFile takes the zip.
 */
function macUpdaterZip(files: Array<Record<string, string>>, arm64Mac: boolean): string | undefined {
  const isArm = (f: Record<string, string>): boolean => f.url.includes('arm64')
  const usable =
    arm64Mac && files.some(isArm) ? files.filter(isArm) : files.filter((f) => !isArm(f))
  return usable.find((f) => f.url.endsWith('.zip'))?.url
}

describe('reading an update file', () => {
  it('reads the shape electron-builder writes', () => {
    const info = parseUpdateInfo(LINUX)
    expect(info.fields.version).toBe('3.20.0')
    expect(info.fields.releaseDate).toBe('2026-09-25T15:12:08.400Z')
    expect(info.files.map((f) => f.url)).toEqual([
      'Universal-Video-Downloader-3.20.0-linux-x86_64.AppImage',
      'Universal-Video-Downloader-3.20.0-linux-amd64.deb'
    ])
    expect(info.files[0].size).toBe('144539415')
    expect(info.files[0].blockMapSize).toBe('151339')
  })

  // A Windows checkout hands the same file over with CRLF.
  it('reads it with Windows line endings too', () => {
    expect(parseUpdateInfo(LINUX.replace(/\n/g, '\r\n'))).toEqual(parseUpdateInfo(LINUX))
  })

  // Half-reading a file we do not understand would publish a guess.
  it('refuses anything outside that shape', () => {
    expect(() => parseUpdateInfo('version: 1.0.0\nfiles: [a.zip]\n')).toThrow(/not a list/)
    expect(() => parseUpdateInfo('version: 1.0.0\n  stray: line\n')).toThrow(/unexpected line 2/)
    expect(() => parseUpdateInfo('version: 1.0.0\nversion: 1.0.1\n')).toThrow(/appears twice/)
    expect(() => parseUpdateInfo('files:\n  - sha512: abc\n')).toThrow(/no url/)
  })
})

describe('merging latest-mac.yml', () => {
  // v3.20.0's lists the Intel files only: an Apple silicon Mac updating
  // through it would be handed the Intel zip.
  it('lists both runners’ files, so each Mac is offered its own zip', () => {
    const merged = parseUpdateInfo(mergeMacUpdateInfo(X64_MAC, ARM64_MAC))
    expect(merged.files.map((f) => f.url)).toEqual([
      'Universal-Video-Downloader-3.20.0-mac-x64.zip',
      'Universal-Video-Downloader-3.20.0-mac-x64.dmg',
      'Universal-Video-Downloader-3.20.0-mac-arm64.zip',
      'Universal-Video-Downloader-3.20.0-mac-arm64.dmg'
    ])
    expect(merged.files[2].size).toBe('131022451')
    expect(macUpdaterZip(merged.files, true)).toBe('Universal-Video-Downloader-3.20.0-mac-arm64.zip')
    expect(macUpdaterZip(merged.files, false)).toBe('Universal-Video-Downloader-3.20.0-mac-x64.zip')
    expect(macUpdaterZip(parseUpdateInfo(X64_MAC).files, true)).toBe(
      'Universal-Video-Downloader-3.20.0-mac-x64.zip'
    )
  })

  it('keeps the Intel file’s version, date and top-level path as they were', () => {
    const merged = mergeMacUpdateInfo(X64_MAC, ARM64_MAC)
    const { fields } = parseUpdateInfo(merged)
    expect(fields).toEqual(parseUpdateInfo(X64_MAC).fields)
    expect(merged.startsWith(X64_MAC.slice(0, X64_MAC.indexOf('path:')))).toBe(true)
    expect(merged.endsWith(X64_MAC.slice(X64_MAC.indexOf('path:')))).toBe(true)
  })

  // The Intel image once came off the arm64 runner, ffmpeg and all.
  it('refuses inputs the wrong way round, or a runner that built the other architecture', () => {
    expect(() => mergeMacUpdateInfo(ARM64_MAC, X64_MAC)).toThrow(/x64 latest-mac\.yml lists .*arm64\.zip/)
    expect(() => mergeMacUpdateInfo(X64_MAC, X64_MAC)).toThrow(/not an Apple silicon file/)
  })

  it('refuses two different versions, or a runner that listed nothing', () => {
    expect(() => mergeMacUpdateInfo(X64_MAC, ARM64_MAC.replace(/3\.20\.0/g, '3.19.1'))).toThrow(
      /different versions: x64 3\.20\.0, arm64 3\.19\.1/
    )
    expect(() => mergeMacUpdateInfo(X64_MAC, 'version: 3.20.0\nfiles:\n')).toThrow(/arm64 .* no files/)
  })
})

describe('what a release must hold', () => {
  // finalize refuses a release missing any of these, so a name that drifts
  // from what electron-builder writes would hold back every release.
  it('names the installers electron-builder.yml produces', () => {
    const productName = /^productName:\s*(.+?)\s*$/m.exec(builderYml)?.[1] ?? ''
    expect(productName.replace(/ /g, '-')).toBe(PRODUCT)
    const section = (key: string): string =>
      new RegExp(`^${key}:\\n((?:[ #].*\\n|\\n)*)`, 'm').exec(builderYml)?.[1] ?? ''
    const pattern = (key: string): string =>
      /^ {2}artifactName:\s*(.+?)\s*$/m.exec(section(key))?.[1] ?? `no artifactName under ${key}`
    const expand = (key: string, arch: string, ext: string): string =>
      pattern(key)
        .replace('${productName}', PRODUCT)
        .replace('${version}', version)
        .replace('${arch}', arch)
        .replace('${ext}', ext)

    // electron-builder's Linux arch names, as the v3.20.0 assets show them.
    const built = [
      expand('win', 'x64', 'exe'),
      expand('dmg', 'arm64', 'dmg'),
      expand('mac', 'arm64', 'zip'),
      expand('dmg', 'x64', 'dmg'),
      expand('mac', 'x64', 'zip'),
      expand('linux', 'x86_64', 'AppImage'),
      expand('linux', 'amd64', 'deb'),
      expand('linux', 'x86_64', 'rpm')
    ]
    expect(built).toEqual(releaseBinaries(version))
  })

  // A link in the notes to a file finalize never checked would 404.
  it('covers every file the release notes link to', () => {
    const linked = [...releaseYml.matchAll(/\[Universal-Video-Downloader-\$V-([^\]]+)\]/g)].map(
      (m) => `${PRODUCT}-${version}-${m[1]}`
    )
    expect(linked.length).toBe(6)
    for (const name of linked) expect(releaseBinaries(version)).toContain(name)
  })

  it('finds everything on v3.20.0, and names what is gone', () => {
    expect(missingAssets('3.20.0', V3_20_0_ASSETS)).toEqual([])
    const withoutIntel = V3_20_0_ASSETS.filter((n) => !n.endsWith('mac-x64.dmg'))
    expect(missingAssets('3.20.0', withoutIntel)).toEqual([
      'Universal-Video-Downloader-3.20.0-mac-x64.dmg'
    ])
    expect(missingAssets('3.20.0', V3_20_0_ASSETS.slice(3))).toEqual([
      'latest.yml',
      'latest-mac.yml',
      'latest-linux.yml'
    ])
  })

  it('counts installers, not blockmaps or update files, as what SHA256SUMS lists', () => {
    expect(installersIn(V3_20_0_ASSETS).sort()).toEqual(releaseBinaries('3.20.0').sort())
  })
})

describe('an update file against the release', () => {
  const actual = new Map(
    parseUpdateInfo(LINUX).files.map((f) => [f.url, { size: Number(f.size), sha512: f.sha512 }])
  )

  it('passes when every file is there with its size and sha512', () => {
    expect(updateInfoProblems('latest-linux.yml', LINUX, '3.20.0', actual)).toEqual([])
  })

  // electron-updater checks both after downloading, so either one wrong is an
  // update every installed copy downloads in full and then throws away.
  it('names a wrong size, a wrong sha512, a missing file and a wrong version', () => {
    const deb = 'Universal-Video-Downloader-3.20.0-linux-amd64.deb'
    const off = new Map(actual)
    off.set(deb, { size: 1, sha512: 'AAAA' })
    expect(updateInfoProblems('latest-linux.yml', LINUX, '3.20.0', off)).toEqual([
      `latest-linux.yml gives ${deb} as 101064556 bytes; the release has 1`,
      `latest-linux.yml has a sha512 for ${deb} that is not the file on the release`
    ])
    off.delete(deb)
    expect(updateInfoProblems('latest-linux.yml', LINUX, '3.20.0', off)).toEqual([
      `latest-linux.yml lists ${deb}, which is not on the release`
    ])
    expect(updateInfoProblems('latest-linux.yml', LINUX, '3.21.0', actual)).toEqual([
      'latest-linux.yml is for 3.20.0, not 3.21.0'
    ])
  })

  it('names a path outside its files, and a file it cannot read', () => {
    const elsewhere = LINUX.replace(/^path: .*$/m, 'path: gone.AppImage')
    expect(updateInfoProblems('latest-linux.yml', elsewhere, '3.20.0', actual)).toEqual([
      'latest-linux.yml points path at gone.AppImage, which is not among its files'
    ])
    expect(updateInfoProblems('latest.yml', '<html>404</html>', '3.20.0', actual)[0]).toMatch(
      /^latest\.yml cannot be read/
    )
  })
})

describe('SHA256SUMS', () => {
  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)

  // `sha256sum --check` wants exactly two spaces (text mode) and one file per line.
  it('is what sha256sum --check reads, sorted by name', () => {
    expect(
      sha256sums([
        { name: 'z.rpm', sha256: a },
        { name: 'A.exe', sha256: b }
      ])
    ).toBe(`${b}  A.exe\n${a}  z.rpm\n`)
  })

  it('refuses a name sha256sum would escape, and anything that is not a digest', () => {
    expect(() => sha256sums([{ name: 'a\nb', sha256: a }])).toThrow(/cannot list/)
    expect(() => sha256sums([{ name: 'a\\b', sha256: a }])).toThrow(/cannot list/)
    expect(() => sha256sums([{ name: 'a', sha256: 'AB' }])).toThrow(/not a SHA-256/)
  })
})

describe('finalizing a release', () => {
  // The finalize job's whole check, on a release laid out as it downloads it:
  // eight small installers, the update files electron-builder would write for
  // them, and each Mac runner's own latest-mac.yml.
  const v = '9.8.7'
  let root = ''
  let assetsDir = ''
  let macDir = ''

  const sha = (algo: string, data: Buffer, enc: 'hex' | 'base64'): string =>
    createHash(algo).update(data).digest(enc)

  function updateFile(urls: string[]): string {
    const entries = urls.map((url) => {
      const data = readFileSync(join(assetsDir, url))
      return { url, sha512: sha('sha512', data, 'base64'), size: data.length }
    })
    return [
      `version: ${v}`,
      'files:',
      ...entries.flatMap((e) => [`  - url: ${e.url}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`]),
      `path: ${entries[0].url}`,
      `sha512: ${entries[0].sha512}`,
      "releaseDate: '2026-10-06T12:00:00.000Z'",
      ''
    ].join('\n')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uvd-finalize-'))
    assetsDir = join(root, 'assets')
    macDir = join(root, 'mac-update-info')
    mkdirSync(assetsDir)
    const [exe, armDmg, armZip, x64Dmg, x64Zip, appImage, deb, rpm] = releaseBinaries(v)
    for (const name of releaseBinaries(v)) writeFileSync(join(assetsDir, name), `the bytes of ${name}`)
    writeFileSync(join(assetsDir, `${exe}.blockmap`), 'not an installer')
    writeFileSync(join(assetsDir, 'latest.yml'), updateFile([exe]))
    writeFileSync(join(assetsDir, 'latest-linux.yml'), updateFile([appImage, deb, rpm]))
    mkdirSync(join(macDir, 'mac-x64'), { recursive: true })
    mkdirSync(join(macDir, 'mac-arm64'), { recursive: true })
    writeFileSync(join(macDir, 'mac-x64', 'latest-mac.yml'), updateFile([x64Zip, x64Dmg]))
    writeFileSync(join(macDir, 'mac-arm64', 'latest-mac.yml'), updateFile([armZip, armDmg]))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const run = () => finalizeRelease({ version: v, assetsDir, macDir })

  it('merges latest-mac.yml and writes SHA256SUMS for every installer', async () => {
    const { installers, warnings } = await run()
    expect(warnings).toEqual([])
    expect(installers).toEqual([...releaseBinaries(v)].sort())

    const mac = parseUpdateInfo(readFileSync(join(assetsDir, 'latest-mac.yml'), 'utf8'))
    expect(mac.files).toHaveLength(4)

    const sums = readFileSync(join(assetsDir, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')
    expect(sums).toHaveLength(8)
    for (const line of sums) {
      const [digest, name] = line.split('  ')
      expect(digest).toBe(sha('sha256', readFileSync(join(assetsDir, name)), 'hex'))
    }
  })

  // The Intel runner queued for hours and never uploaded: v3.20.0 would have
  // gone out without it, and nobody would have been told.
  it('refuses a release a runner has not uploaded to', async () => {
    rmSync(join(assetsDir, releaseBinaries(v)[3]))
    await expect(run()).rejects.toThrow(/not on the release: .*mac-x64\.dmg/)
  })

  // A re-run that rebuilt an installer after its update file was uploaded.
  it('refuses an update file that describes other bytes', async () => {
    writeFileSync(join(assetsDir, releaseBinaries(v)[0]), 'rebuilt, and larger than before')
    await expect(run()).rejects.toThrow(/latest\.yml gives .*setup\.exe as \d+ bytes/)
  })

  it('refuses when a Mac runner kept no latest-mac.yml', async () => {
    rmSync(join(macDir, 'mac-arm64'), { recursive: true })
    await expect(run()).rejects.toThrow(/mac-arm64\/latest-mac\.yml is missing/)
  })

  it('lists an installer it does not know, and says so', async () => {
    const extra = `${PRODUCT}-${v}-linux-arm64.deb`
    writeFileSync(join(assetsDir, extra), 'a new target')
    const { installers, warnings } = await run()
    expect(installers).toContain(extra)
    expect(warnings).toEqual([
      `${extra} is on the release but not in scripts/release-assets.mjs or the notes`
    ])
  })
})

/** The jobs of a workflow, by id, each with its own lines and comments dropped. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'))
  const out = new Map<string, string>()
  const parts = body.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1)
  for (const part of parts) {
    const id = part.slice(0, part.indexOf(':'))
    out.set(id, part.replace(/^\s*#.*$\n?/gm, ''))
  }
  return out
}

const ON_A_TAG = "if: startsWith(github.ref, 'refs/tags/v')"

describe('the release workflow', () => {
  // With `release`, the first runner to finish made the release public while
  // the rest were still building.
  it('has electron-builder upload into a draft', () => {
    expect(builderYml).toMatch(/^publish:\n(?: .*\n)*? {2}releaseType: draft\n/m)
  })

  // A manual run after a version bump, before the tag, used to publish that
  // version from main — untagged, unchecked and public.
  it('publishes nothing from a manual run', () => {
    const all = jobs(releaseYml)
    const build = all.get('build') ?? ''
    expect(build).toContain(
      "--publish ${{ startsWith(github.ref, 'refs/tags/v') && 'always' || 'never' }}"
    )
    expect(releaseYml).not.toMatch(/--publish always/)

    // Every step that talks to the release runs on a tag only.
    for (const [id, job] of all) {
      const head = job.slice(0, job.indexOf('\n    steps:'))
      const steps = job.split(/^ {6}- /m).slice(1)
      for (const step of steps.filter((s) => s.includes('gh release'))) {
        const gated = head.includes(`    ${ON_A_TAG}`) || step.includes(ON_A_TAG)
        expect(gated, `${id}: ${step.split('\n')[0]}`).toBe(true)
      }
    }
  })

  // Publishing before the last runner has finished is the bug itself.
  it('publishes only after every build, from a job that checks the release first', () => {
    const finalize = jobs(releaseYml).get('finalize') ?? ''
    expect(finalize).toMatch(/^ {4}needs: build$/m)
    expect(finalize).toContain(`    ${ON_A_TAG}`)
    const at = (s: string): number => finalize.indexOf(s)
    expect(at('node scripts/finalize-release.mjs')).toBeGreaterThan(0)
    expect(at('node scripts/finalize-release.mjs')).toBeLessThan(at('--draft=false'))
    expect(at('gh release upload')).toBeLessThan(at('--draft=false'))
  })

  // finalize-release.mjs reads mac-x64/ and mac-arm64/.
  it('keeps each Mac runner’s latest-mac.yml under the name finalize reads', () => {
    const build = jobs(releaseYml).get('build') ?? ''
    expect(build).toContain(
      'name: ${{ matrix.platform }}-${{ matrix.arch }}\n          path: release/*/latest-mac.yml'
    )
    expect(build).toMatch(/platform: mac\n\s+args: --arm64\n\s+arch: arm64/)
    expect(build).toMatch(/platform: mac\n\s+args: --x64\n\s+arch: x64/)
    expect(jobs(releaseYml).get('finalize')).toContain('pattern: mac-*')
  })

  // Node 20 reached end of life in April 2026; setup-node keeps installing it.
  it('builds on a Node that is still supported', () => {
    for (const workflow of [releaseYml, ciYml]) {
      const versions = [...workflow.matchAll(/node-version:\s*['"]?(\d+)/g)].map((m) => Number(m[1]))
      expect(versions.length).toBeGreaterThan(0)
      for (const v of versions) expect(v).toBeGreaterThanOrEqual(22)
    }
  })
})
