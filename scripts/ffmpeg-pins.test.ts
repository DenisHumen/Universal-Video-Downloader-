import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import afterPack from './after-pack.mjs'
import {
  NONFREE_MARKER,
  PINNED,
  VERSION,
  bannerMatches,
  ffmpegReadme,
  isNonfree,
  missingLibraries,
  missingNotices,
  noticeProblems,
  tarArgs,
  thirdPartyProblems
} from './ffmpeg-pins.mjs'

const GPL3 = readFileSync('node_modules/ffmpeg-static/LICENSE', 'utf-8')
const NOTICES = readFileSync('THIRD_PARTY_NOTICES.txt', 'utf-8')
const builderYml = readFileSync('electron-builder.yml', 'utf-8')

/** The opening of the README ffmpeg-static installs beside its own binary. */
const STALE_README =
  'FFmpeg 64-bit static Windows build from www.gyan.dev\n\nVersion: 6.1.1-essentials_build-www.gyan.dev\n'

/** As much of an ffmpeg binary as these checks read: its configure line, and any extra. */
const fakeBinary = (extra = ''): Buffer =>
  Buffer.from(
    '\0--enable-gpl --enable-version3 --enable-libx264 --enable-libvpx --enable-libopus ' +
      `--enable-libmp3lame\0${extra}\0`
  )

describe('the pinned builds', () => {
  // A daily or "latest" URL changes under the build or disappears; the SHA-256
  // is what stops a republished archive from shipping.
  it('are versioned URLs, each with a SHA-256, a source and the build scripts', () => {
    for (const [target, pin] of Object.entries(PINNED)) {
      expect(pin.sha256, target).toMatch(/^[0-9a-f]{64}$/)
      expect(pin.url, target).toMatch(/^https:\/\//)
      expect(pin.url, target).not.toMatch(/latest/i)
      expect(pin.url, target).toContain(VERSION)
      for (const url of [pin.source, pin.sourceArchive, pin.buildScripts])
        expect(url, target).toMatch(/^https:\/\//)
    }
  })

  // BtbN prunes its daily autobuilds after about two weeks and keeps the last
  // one of each month, so any other tag turns CI into a 404 within weeks.
  it('take a BtbN build only from a month-end autobuild', () => {
    const btbn = Object.values(PINNED).filter((p) => p.url.includes('/BtbN/'))
    expect(btbn.length).toBeGreaterThan(0)
    for (const pin of btbn) {
      const m = /\/autobuild-(\d{4})-(\d{2})-(\d{2})-/.exec(pin.url)
      expect(m, pin.url).not.toBeNull()
      const [year, month, day] = m!.slice(1).map(Number)
      expect(day).toBe(new Date(Date.UTC(year, month, 0)).getUTCDate())
    }
  })

  // A git build is not the release tarball: BtbN's is 9.0.2 plus 17 fixes, and
  // pointing users at ffmpeg-9.0.2.tar.xz would name the wrong source.
  it('point a git build at the commit it was built from', () => {
    for (const pin of Object.values(PINNED)) {
      const commit = /-g([0-9a-f]{7,})-/.exec(pin.url)?.[1]
      if (!commit) continue
      expect(pin.source).toContain(commit)
      expect(pin.sourceArchive).toContain(commit)
    }
  })

  // Members are unpacked by exact path, so one that does not start with the
  // archive's own folder fails only when a release is being built.
  it('name tar members inside the folder of the archive they come from', () => {
    for (const pin of Object.values(PINNED).filter((p) => p.extract === 'tar.xz')) {
      const folder = pin.url.split('/').pop()!.replace(/\.tar\.xz$/, '')
      for (const member of [pin.member, pin.readme, pin.licence].filter(Boolean))
        expect(member!.startsWith(`${folder}/`), member).toBe(true)
    }
  })
})

describe('the nonfree gate', () => {
  // The Linux build in v3.20.0 carried exactly this string; FFmpeg compiles it
  // into every build configured with --enable-nonfree.
  it('refuses a binary that carries the nonfree verdict', () => {
    expect(isNonfree(fakeBinary())).toBe(false)
    expect(isNonfree(fakeBinary(`License: ${NONFREE_MARKER}`))).toBe(true)
    expect(noticeProblems({ name: 'ffmpeg', binary: fakeBinary(NONFREE_MARKER), readme: null, licence: null }))
      .toContain(`ffmpeg is a nonfree build ("${NONFREE_MARKER}") and may not be redistributed`)
  })

  // A builder's LGPL variant leaves out every encoder trim and convert use.
  it('names the encoders a build was configured without', () => {
    expect(missingLibraries(fakeBinary())).toEqual([])
    expect(missingLibraries(Buffer.from('--enable-gpl --enable-libvpx --enable-libopus'))).toEqual([
      'libx264',
      'libmp3lame'
    ])
  })
})

describe('the banner check', () => {
  // BtbN builds from git; `includes('version 9.0.2')` rejected its banner and
  // would have accepted 9.0.20.
  it('accepts each builder spelling of the pinned version and nothing near it', () => {
    expect(bannerMatches('ffmpeg version n9.0.2-17-g2a571b6068-20260930 Copyright (c) 2000-2026')).toBe(true)
    expect(bannerMatches('ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright (c) 2000-2026')).toBe(true)
    expect(bannerMatches('ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers')).toBe(true)
    expect(bannerMatches('ffmpeg version 9.0.20 Copyright (c) 2000-2026')).toBe(false)
    expect(bannerMatches('ffmpeg version 6.1.1-essentials_build-www.gyan.dev')).toBe(false)
    expect(bannerMatches('ffmpeg version 9002')).toBe(false)
  })
})

describe('tar', () => {
  // --wildcards is GNU-only: bsdtar, which Windows and macOS ship, rejects it.
  it('unpacks exact members with flags both GNU tar and bsdtar know', () => {
    const args = tarArgs('archive.tar.xz', ['d/bin/ffmpeg', 'd/LICENSE.txt'])
    expect(args).toEqual(['-xJf', 'archive.tar.xz', 'd/bin/ffmpeg', 'd/LICENSE.txt'])
    expect(args.some((a) => a.startsWith('--wildcards'))).toBe(false)
  })
})

describe('the README beside ffmpeg', () => {
  // It was ffmpeg-static's README for 6.1.1, naming a commit the 9.0.2 binary
  // was not built from - the only source pointer the app shipped.
  it('names the version, licence, source, builder and archive of this build', () => {
    const pin = PINNED['linux-x64']
    const readme = ffmpegReadme('linux-x64', pin)
    expect(readme.startsWith(`FFmpeg ${VERSION} for linux-x64`)).toBe(true)
    for (const part of [
      'GPL-3.0-or-later',
      'ffmpeg.LICENSE',
      pin.source,
      pin.sourceArchive,
      pin.builder,
      pin.buildScripts,
      pin.url,
      pin.sha256
    ])
      expect(readme).toContain(part)
    expect(noticeProblems({ name: 'ffmpeg', binary: fakeBinary(), readme, licence: GPL3 })).toEqual([])
  })

  it('keeps the builder README after the header, with Unix line endings', () => {
    const body = 'FFmpeg 64-bit static Windows build from www.gyan.dev\r\n\r\nVersion: 9.0.2\r\n'
    const readme = ffmpegReadme('win32-x64', PINNED['win32-x64'], body)
    expect(readme).toContain('full text in ffmpeg.exe.LICENSE')
    expect(readme).toContain('FFmpeg 64-bit static Windows build from www.gyan.dev\n\nVersion: 9.0.2\n')
    expect(readme.includes('\r')).toBe(false)
  })
})

describe('noticeProblems', () => {
  const good = {
    name: 'ffmpeg',
    binary: fakeBinary(),
    readme: ffmpegReadme('linux-x64', PINNED['linux-x64']),
    licence: GPL3
  }

  // v3.20.0 packed ffmpeg-static's 6.1.1 README beside the 9.0.2 binary; the
  // next version bump would have left this one just as stale.
  it('refuses a README written for another binary or another version', () => {
    expect(noticeProblems({ ...good, readme: STALE_README })).toEqual([
      'ffmpeg.README is not the notice for ffmpeg 9.0.2: "FFmpeg 64-bit static Windows build from www.gyan.dev"'
    ])
    expect(noticeProblems(good, '9.0.3')).toHaveLength(1)
  })

  it('refuses missing notices and a licence that is not the GPLv3', () => {
    expect(noticeProblems({ ...good, readme: null, licence: null })).toEqual([
      'ffmpeg.README is missing',
      'ffmpeg.LICENSE is missing'
    ])
    expect(noticeProblems({ ...good, licence: 'MIT License' })).toEqual([
      'ffmpeg.LICENSE is not the text of the GPLv3'
    ])
  })
})

describe('THIRD_PARTY_NOTICES.txt', () => {
  // Shipped in every package as the notice users get; a pin bumped without it
  // would send them to the source of a build they do not have.
  it('names this ffmpeg and every pinned archive, source and build script', () => {
    expect(thirdPartyProblems(NOTICES)).toEqual([])
    expect(NOTICES).toMatch(/Written offer/)
  })

  it('notices a pin or a version it does not mention', () => {
    const moved = { ...PINNED['linux-x64'], url: 'https://example.com/ffmpeg-9.0.2.tar.xz' }
    expect(thirdPartyProblems(NOTICES, VERSION, { ...PINNED, 'linux-x64': moved })).toEqual([
      'THIRD_PARTY_NOTICES.txt: it does not give https://example.com/ffmpeg-9.0.2.tar.xz'
    ])
    expect(thirdPartyProblems(NOTICES, '9.0.3')[0]).toMatch(/does not name FFmpeg 9\.0\.3/)
  })

  // README.md is excluded from the package, so this file has to be copied in.
  it('is copied into the resources by extraResources and kept out of app.asar', () => {
    expect(builderYml).toMatch(
      /^extraResources:\s+- from: THIRD_PARTY_NOTICES\.txt\s+to: THIRD_PARTY_NOTICES\.txt\s/m
    )
    expect(builderYml).toMatch(/README\.md,THIRD_PARTY_NOTICES\.txt\}'/)
  })
})

describe('missingNotices', () => {
  const opt = '/opt/Universal Video Downloader/resources'
  it('names the notices an rpm file list leaves out', () => {
    const all = [
      `${opt}/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg`,
      `${opt}/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.README`,
      `${opt}/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.LICENSE`,
      `${opt}/THIRD_PARTY_NOTICES.txt`
    ]
    expect(missingNotices(all)).toEqual([])
    expect(missingNotices(all.slice(0, 2))).toEqual([
      'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.LICENSE',
      'resources/THIRD_PARTY_NOTICES.txt'
    ])
  })
})

describe('after-pack', () => {
  // The hook electron-builder runs on every packed app before its installer is
  // built. This packs a Mac one by hand: an arm64 Mach-O header is all the
  // architecture check reads, and the notice checks read the rest.
  const product = 'Universal Video Downloader'
  let appOutDir = ''
  let resources = ''
  let ffmpeg = ''

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    appOutDir = mkdtempSync(join(tmpdir(), 'uvd-afterpack-'))
    resources = join(appOutDir, `${product}.app`, 'Contents', 'Resources')
    const unpacked = join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static')
    mkdirSync(unpacked, { recursive: true })
    ffmpeg = join(unpacked, 'ffmpeg')
    plant()
    writeFileSync(`${ffmpeg}.README`, ffmpegReadme('darwin-arm64', PINNED['darwin-arm64']))
    writeFileSync(`${ffmpeg}.LICENSE`, GPL3)
    writeFileSync(join(resources, 'THIRD_PARTY_NOTICES.txt'), NOTICES)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(appOutDir, { recursive: true, force: true })
  })

  /** An arm64 Mach-O: the magic, then cputype 0x0100000c, little-endian. */
  function plant(extra = '') {
    const head = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])
    writeFileSync(ffmpeg, Buffer.concat([head, fakeBinary(extra)]))
  }

  const pack = () =>
    afterPack({
      appOutDir,
      electronPlatformName: 'darwin',
      arch: 3,
      packager: { appInfo: { productFilename: product } }
    })

  it('passes an app whose ffmpeg is redistributable and described', async () => {
    await expect(pack()).resolves.toBeUndefined()
  })

  // The guard that would have stopped every v3.20.0 Linux package.
  it('fails on a planted nonfree marker', async () => {
    plant(`License: ${NONFREE_MARKER}`)
    await expect(pack()).rejects.toThrow(/nonfree build/)
  })

  // A package built without fetch-ffmpeg still carries ffmpeg-static's README.
  it('fails while the README is still the one for 6.1.1', async () => {
    writeFileSync(`${ffmpeg}.README`, STALE_README)
    await expect(pack()).rejects.toThrow(/not the notice for ffmpeg 9\.0\.2/)
  })

  it('fails without THIRD_PARTY_NOTICES.txt in the resources', async () => {
    rmSync(join(resources, 'THIRD_PARTY_NOTICES.txt'))
    await expect(pack()).rejects.toThrow(/THIRD_PARTY_NOTICES\.txt is missing/)
  })
})
