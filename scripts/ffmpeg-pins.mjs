/**
 * Which ffmpeg every build ships, where each copy comes from, and what has to
 * travel with it.
 *
 * ffmpeg is GPL, so a copy we hand out has to be one we may hand out, together
 * with its licence and a way to its source. Both had gone wrong without any
 * build noticing, because the binaries ran fine:
 *
 *  - The Linux build pinned for v3.20.0 was configured with --enable-nonfree
 *    (decklink alongside GPL code), which FFmpeg's own licence check calls
 *    "nonfree and unredistributable". Every .AppImage, .deb and .rpm carried
 *    it. FFmpeg compiles that verdict into such a binary as a string, so a
 *    build step can look for it - and now refuses the binary when it is there.
 *  - fetch-ffmpeg replaced only the binary, so beside a 9.0.2 ffmpeg sat
 *    ffmpeg-static's README for 6.1.1, naming a source commit the binary was
 *    not built from. It was the only source pointer the app shipped, on every
 *    platform. Each pin below now says where its source and its builder's
 *    scripts are, the README beside the binary is written from that, and a
 *    package whose README describes another version is not built.
 *
 * Imported by scripts/fetch-ffmpeg.mjs (which downloads and writes),
 * scripts/after-pack.mjs (which checks each packed app before its installer
 * exists) and scripts/check-linux-packages.mjs (which checks the .deb and .rpm).
 */

export const VERSION = '9.0.2'

/** What FFmpeg compiles into a build configured with --enable-nonfree. */
export const NONFREE_MARKER = 'nonfree and unredistributable'

/**
 * The encoders the app's trim and convert presets name (src/main/services/
 * ffmpeg.ts). A build without one fails those conversions at runtime, and the
 * likeliest way to get there is reaching for a builder's LGPL variant, which
 * leaves all four out.
 */
export const REQUIRED_LIBRARIES = ['libx264', 'libvpx', 'libopus', 'libmp3lame']

/** FFmpeg's 9.0.2 release, which gyan.dev and martin-riedl.de both build from. */
const RELEASE_SOURCE = 'https://github.com/FFmpeg/FFmpeg/tree/n9.0.2'
const RELEASE_TARBALL = 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz'

const MARTIN_RIEDL = {
  builder: 'Martin Riedl (ffmpeg.martin-riedl.de)',
  buildScripts: 'https://git.martin-riedl.de/ffmpeg/build-script',
  source: RELEASE_SOURCE,
  sourceArchive: RELEASE_TARBALL
}

/**
 * Every archive by URL *and* SHA-256: a build server that quietly republishes
 * something different fails the build instead of shipping it.
 *
 * `member` is the binary inside the archive; `readme` and `licence`, when the
 * archive has them, are the builder's own files, shipped instead of generated
 * ones. Martin Riedl's zips hold nothing but the binary, so those targets get a
 * generated README and ffmpeg-static's copy of the GPLv3.
 */
export const PINNED = {
  'win32-x64': {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    member: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
    // gyan's README carries the build's real configuration and source commit.
    readme: 'ffmpeg-9.0.2-essentials_build/README.txt',
    licence: 'ffmpeg-9.0.2-essentials_build/LICENSE',
    bin: 'ffmpeg.exe',
    builder: 'gyan.dev',
    buildScripts: 'https://www.gyan.dev/ffmpeg/builds/',
    source: RELEASE_SOURCE,
    sourceArchive: RELEASE_TARBALL
  },
  'darwin-arm64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
    sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
    member: 'ffmpeg',
    bin: 'ffmpeg',
    ...MARTIN_RIEDL
  },
  'darwin-x64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
    sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
    member: 'ffmpeg',
    bin: 'ffmpeg',
    ...MARTIN_RIEDL
  },
  // BtbN's GPL build of the 9.0 branch: 9.0.2 plus 17 fixes, so its source is
  // that commit rather than the release tarball, and its build scripts are the
  // repository at the autobuild's tag. A month-end autobuild on purpose: BtbN
  // prunes the daily ones after about two weeks, and the URL would start to 404.
  'linux-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz',
    sha256: '68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269',
    extract: 'tar.xz',
    member: 'ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0/bin/ffmpeg',
    licence: 'ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0/LICENSE.txt',
    bin: 'ffmpeg',
    builder: 'BtbN/FFmpeg-Builds',
    buildScripts: 'https://github.com/BtbN/FFmpeg-Builds/tree/6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b',
    source: 'https://github.com/FFmpeg/FFmpeg/tree/2a571b606854520cf89804d8030c8b328e621689',
    sourceArchive:
      'https://github.com/FFmpeg/FFmpeg/archive/2a571b606854520cf89804d8030c8b328e621689.tar.gz'
  }
}

/** Whether a binary was built with --enable-nonfree, and so may not be passed on. */
export function isNonfree(binary) {
  return binary.includes(NONFREE_MARKER)
}

/**
 * The required encoders a binary was configured without. Every ffmpeg carries
 * its configure line as a string, which is what `ffmpeg -version` prints, so
 * this works on a binary for another platform as well.
 */
export function missingLibraries(binary) {
  return REQUIRED_LIBRARIES.filter((lib) => !binary.includes(`--enable-${lib}`))
}

/**
 * Whether the first line of `ffmpeg -version` is the version we pinned.
 *
 * BtbN builds from git, so its banner reads "version n9.0.2-17-g2a571b6068";
 * gyan's and Martin Riedl's read "version 9.0.2-…" and "version 9.0.2". A plain
 * `includes('version 9.0.2')` rejected the first and would have let 9.0.20 by.
 */
export function bannerMatches(banner, version = VERSION) {
  return new RegExp(`version n?${version.replaceAll('.', '\\.')}\\b`).test(banner)
}

/**
 * tar's arguments for pulling exact members out of a .tar.xz into the current
 * directory. Exact paths rather than --wildcards, which is GNU-only: the bsdtar
 * that Windows and macOS ship rejects it, so `--target=linux-x64` run there
 * would fail for a reason that has nothing to do with ffmpeg.
 */
export function tarArgs(archive, members) {
  return ['-xJf', archive, ...members]
}

/**
 * The README that sits beside the binary, under the name ffmpeg-static gives
 * its own (ffmpeg.README, ffmpeg.exe.README), so the 6.1.1 one is overwritten
 * rather than left next to a binary it does not describe.
 *
 * `body` follows the header: the builder's own README when the archive has one,
 * or `ffmpeg -buildconf` when the binary could be run here. A binary for
 * another platform cannot be, so a cross-target README stops at the header.
 */
export function ffmpegReadme(target, pin, body = '') {
  const header = [
    `FFmpeg ${VERSION} for ${target}, as bundled with Universal Video Downloader`,
    '',
    `License:        GPL-3.0-or-later, full text in ${pin.bin}.LICENSE beside this file`,
    `Source code:    ${pin.source}`,
    `Source archive: ${pin.sourceArchive}`,
    `Built by:       ${pin.builder}`,
    `Build scripts:  ${pin.buildScripts}`,
    `Binary from:    ${pin.url}`,
    `SHA-256:        ${pin.sha256}`,
    '',
    'ffmpeg runs as a separate program; Universal Video Downloader itself is MIT',
    'licensed. THIRD_PARTY_NOTICES.txt in its resources folder lists everything',
    'the app ships, where the source of each part is, and how to ask for it.',
    ''
  ].join('\n')
  const rest = body.replace(/\r\n/g, '\n').trim()
  return rest ? `${header}\n${'-'.repeat(76)}\n\n${rest}\n` : header
}

const GPL3 = /GNU GENERAL PUBLIC LICENSE\s+Version 3/

/**
 * Why the ffmpeg in a package could not be passed on as it stands.
 *
 * `readme` and `licence` are the texts beside the binary, null when missing.
 * The README has to open with the header ffmpegReadme writes, for this version:
 * ffmpeg-static's own README opens differently, so a build that skipped
 * fetch-ffmpeg - or one after a version bump that forgot the notices - fails
 * here instead of shipping a notice about some other binary.
 */
export function noticeProblems({ name, binary, readme, licence }, version = VERSION) {
  const problems = []
  if (isNonfree(binary))
    problems.push(`${name} is a nonfree build ("${NONFREE_MARKER}") and may not be redistributed`)
  if (readme == null) problems.push(`${name}.README is missing`)
  else if (!readme.startsWith(`FFmpeg ${version} for `)) {
    const first = readme.split('\n', 1)[0].trim()
    problems.push(`${name}.README is not the notice for ffmpeg ${version}: "${first}"`)
  }
  if (licence == null) problems.push(`${name}.LICENSE is missing`)
  else if (!GPL3.test(licence)) problems.push(`${name}.LICENSE is not the text of the GPLv3`)
  return problems
}

/**
 * Why THIRD_PARTY_NOTICES.txt would mislead about the ffmpeg in this release:
 * it has to name the version, and every pinned archive with its source and
 * build scripts, so bumping a pin without updating it fails the build.
 */
export function thirdPartyProblems(text, version = VERSION, pins = PINNED) {
  const problems = []
  if (!text.includes(`FFmpeg ${version}`)) problems.push(`it does not name FFmpeg ${version}`)
  const wanted = new Set()
  for (const pin of Object.values(pins))
    for (const url of [pin.url, pin.source, pin.sourceArchive, pin.buildScripts]) wanted.add(url)
  for (const url of wanted) if (!text.includes(url)) problems.push(`it does not give ${url}`)
  return problems.map((p) => `THIRD_PARTY_NOTICES.txt: ${p}`)
}

/** Where the notices land inside an installed Linux package, under /opt/<product>/. */
export const LINUX_NOTICE_PATHS = [
  'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.README',
  'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.LICENSE',
  'resources/THIRD_PARTY_NOTICES.txt'
]

/** The notices missing from a package's file list. */
export function missingNotices(paths) {
  return LINUX_NOTICE_PATHS.filter((n) => !paths.some((p) => p.replace(/\\/g, '/').endsWith(`/${n}`)))
}
