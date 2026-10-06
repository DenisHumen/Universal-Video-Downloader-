import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  HICOLOR_SIZES,
  desktopEntryProblems,
  fillMacros,
  hicolorSizes,
  iconProblems,
  layoutProblems,
  packageLayout,
  pngSize,
  profileProblem,
  rpmScriptlets,
  scriptProblems,
  unknownMacros
} from './linux-package.mjs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
  name: string
  desktopName?: string
}
const builderYml = readFileSync('electron-builder.yml', 'utf-8')
const productName = /^productName:\s*(.+?)\s*$/m.exec(builderYml)?.[1] ?? ''
const executable = pkg.name
const installed = `/opt/${productName}/${executable}`
const macros = { executable, sanitizedProductName: productName, productFilename: productName }

const postinstSource = readFileSync('build/linux/after-install.sh', 'utf-8')
const postrmSource = readFileSync('build/linux/after-remove.sh', 'utf-8')

/** The 24 bytes of a PNG that carry its size, which is all pngSize reads. */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

/** A complete set of icons, as electron-builder would install them. */
const fullIconSet = (size = (n: number) => n): Map<string, Buffer> =>
  new Map(HICOLOR_SIZES.map((n) => [`${n}x${n}.png`, pngHeader(size(n), size(n))]))

describe('the AppArmor profile', () => {
  // v3.20.0's .deb had no profile and aborted on Ubuntu 24.04; one for any
  // other path attaches to nothing and aborts the same way.
  it('attaches to the executable the packages install', () => {
    expect(productName).not.toBe('')
    const profile = readFileSync('build/linux/apparmor-profile', 'utf-8')
    expect(profileProblem(profile, installed, executable)).toBeNull()
  })

  it('is what linux.extraResources ships as resources/apparmor-profile', () => {
    expect(builderYml).toMatch(/- from: build\/linux\/apparmor-profile\s+to: apparmor-profile\s/)
  })

  it('names a profile for the wrong path, and a file without one', () => {
    const elsewhere = 'profile universal-video-downloader /usr/bin/universal-video-downloader {}'
    expect(profileProblem(elsewhere, installed, executable)).toMatch(/installs \/opt\//)
    expect(profileProblem('# nothing here', installed, executable)).toMatch(/declares no profile/)
  })
})

describe('the package scripts', () => {
  // FpmTarget throws on any braced name it does not know, so a `${var}` in the
  // shell would fail the release build rather than the install.
  it('use only the macros electron-builder fills in', () => {
    expect(unknownMacros(postinstSource)).toEqual([])
    expect(unknownMacros(postrmSource)).toEqual([])
    expect(unknownMacros('echo "${HOME}" ${executable}')).toEqual(['HOME'])
  })

  // A Windows checkout with autocrlf would hand bash `$'\r': command not found`.
  it('keep Unix line endings', () => {
    expect(postinstSource.includes('\r')).toBe(false)
    expect(postrmSource.includes('\r')).toBe(false)
  })

  it('are the ones both the deb and the rpm run', () => {
    expect(builderYml.match(/afterInstall: build\/linux\/after-install\.sh/g)).toHaveLength(2)
    expect(builderYml.match(/afterRemove: build\/linux\/after-remove\.sh/g)).toHaveLength(2)
  })

  it('install and load the profile from where the package puts it', () => {
    const postinst = fillMacros(postinstSource, macros)
    const postrm = fillMacros(postrmSource, macros)
    expect(postinst).toContain(`'/opt/${productName}/resources/apparmor-profile'`)
    expect(scriptProblems(postinst, postrm, executable)).toEqual([])
  })

  // The stock 25.1.8 scripts: no profile at all, and a remove script that runs
  // on upgrades too — after the new version's install, in an rpm.
  it('flag what electron-builder 25 ships by default', () => {
    const stockPostinst = "chmod 0755 '/opt/Universal Video Downloader/chrome-sandbox' || true"
    const stockPostrm = "update-alternatives --remove 'universal-video-downloader' '/usr/bin/x'"
    expect(scriptProblems(stockPostinst, stockPostrm, executable)).toEqual([
      'the install script never loads an AppArmor profile',
      'the install script does not install /etc/apparmor.d/universal-video-downloader',
      'the remove script does not leave upgrades alone',
      'the install script does not put uvd on the PATH',
      'the remove script leaves /usr/bin/uvd behind'
    ])
  })

  it('put the uvd command on the PATH, and take only their own link away again', () => {
    const postinst = fillMacros(postinstSource, macros)
    const postrm = fillMacros(postrmSource, macros)
    expect(postinst).toContain(`ln -sf '/opt/${productName}/resources/bin/uvd' '/usr/bin/uvd'`)
    expect(postrm).toContain(`= '/opt/${productName}/resources/bin/uvd' ]`)
  })

  it('fill macros the way FpmTarget does, refusing unknown ones', () => {
    expect(fillMacros("'/opt/${sanitizedProductName}/x'", macros)).toBe(`'/opt/${productName}/x'`)
    expect(() => fillMacros('${version}', macros)).toThrow('Macro version is not defined')
  })
})

describe('rpmScriptlets', () => {
  it('splits rpm -qp --scripts output by heading', () => {
    const out = [
      'postinstall scriptlet (using /bin/sh):',
      '#!/bin/bash',
      'apparmor_parser --replace x',
      'postuninstall scriptlet (using /bin/sh):',
      'case "$1" in'
    ].join('\n')
    expect(rpmScriptlets(out)).toEqual({
      postinstall: '#!/bin/bash\napparmor_parser --replace x',
      postuninstall: 'case "$1" in'
    })
  })
})

describe('icons', () => {
  // CI only has what is committed; with build/icons ignored, the packages
  // shipped a lone 1024px icon that the hicolor theme never looks up.
  it('build/icons holds every hicolor size, each really that size', () => {
    const files = new Map(
      readdirSync('build/icons').map((name) => [name, readFileSync(join('build/icons', name))])
    )
    expect(iconProblems(files)).toEqual([])
  })

  it('stops at 512, the largest size index.theme lists for apps', () => {
    expect(Math.max(...HICOLOR_SIZES)).toBe(512)
    expect(HICOLOR_SIZES).toContain(48)
  })

  it('reports a missing size and a file whose pixels disagree with its name', () => {
    const files = fullIconSet()
    files.delete('48x48.png')
    files.set('64x64.png', pngHeader(1024, 1024))
    files.set('16x16.png', Buffer.from('not a png'))
    expect(iconProblems(files)).toEqual([
      '16x16.png is not a PNG',
      '48x48.png is missing',
      '64x64.png is really 1024x1024'
    ])
  })

  it('reads the size from a PNG header and nothing else', () => {
    expect(pngSize(pngHeader(48, 48))).toEqual({ width: 48, height: 48 })
    expect(pngSize(Buffer.alloc(24))).toBeNull()
  })

  it('finds hicolor sizes in an rpm listing and an extracted deb alike', () => {
    const name = 'universal-video-downloader'
    expect(
      hicolorSizes(
        [
          `/usr/share/icons/hicolor/1024x1024/apps/${name}.png`,
          `usr/share/icons/hicolor/48x48/apps/${name}.png`,
          '/usr/share/icons/hicolor/48x32/apps/universal-video-downloader.png',
          '/usr/share/icons/hicolor/256x256/apps/someone-else.png'
        ],
        name
      )
    ).toEqual([48, 1024])
  })
})

describe('the desktop entry', () => {
  // Read out of the v3.20.0 AppImage.
  const shipped = [
    '[Desktop Entry]',
    'Name=Universal Video Downloader',
    'Exec=AppRun --no-sandbox %U',
    'Terminal=false',
    'Type=Application',
    'Icon=universal-video-downloader',
    'StartupWMClass=Universal Video Downloader',
    'X-AppImage-Version=3.20.0',
    'entry=[object Object]',
    'Categories=AudioVideo;'
  ].join('\n')

  // What electron-builder 25.1.8 writes from this config now.
  const fixed = [
    '[Desktop Entry]',
    'Name=Universal Video Downloader',
    'Exec="/opt/Universal Video Downloader/universal-video-downloader" %U',
    'Terminal=false',
    'Type=Application',
    'Icon=universal-video-downloader',
    'StartupWMClass=universal-video-downloader',
    'GenericName=Video Downloader',
    'Keywords=video;download;downloader;youtube;yt-dlp;stream;',
    'Name[ru]=Universal Video Downloader',
    'Categories=AudioVideo;Video;'
  ].join('\n')

  it('catches every fault the shipped one had', () => {
    expect(desktopEntryProblems(shipped, executable)).toEqual([
      '"entry" is not a desktop entry key',
      '"entry" holds a printed JavaScript object',
      'StartupWMClass is "Universal Video Downloader", not "universal-video-downloader"'
    ])
  })

  it('passes the one written from the current config', () => {
    expect(desktopEntryProblems(fixed, executable)).toEqual([])
  })

  // Electron names the window after package.json's name and desktopName; the
  // dock matches windows to launchers by that, or shows a second icon.
  it('declares the window class Electron actually sets', () => {
    expect(builderYml).toMatch(new RegExp(`^\\s+StartupWMClass: ${executable}\\s*$`, 'm'))
    expect(pkg.desktopName).toBe(`${executable}.desktop`)
  })

  // 25 copies `desktop` key by key; a nested map comes out as [object Object].
  it('is configured with flat keys, the way electron-builder 25 reads them', () => {
    expect(builderYml).not.toMatch(/^\s+entry:\s*$/m)
  })
})

describe('a built package', () => {
  const product = 'Universal Video Downloader'
  const files = (prefix: string, sizes = HICOLOR_SIZES): string[] => [
    `${prefix}opt/${product}/${executable}`,
    `${prefix}opt/${product}/chrome-sandbox`,
    `${prefix}opt/${product}/resources/apparmor-profile`,
    `${prefix}opt/${product}/resources/bin/uvd`,
    `${prefix}usr/share/applications/${executable}.desktop`,
    ...sizes.map((n) => `${prefix}usr/share/icons/hicolor/${n}x${n}/apps/${executable}.png`)
  ]

  it('takes its executable and product folder from its own file list', () => {
    expect(packageLayout(files('/'))).toEqual({ executable, product })
  })

  it('passes with everything in place, listed either way', () => {
    expect(layoutProblems(files(''))).toEqual([])
    expect(layoutProblems(files('/'))).toEqual([])
  })

  // What v3.20.0's rpm held: no profile, and the 1024px icon only.
  it('names what v3.20.0 was missing', () => {
    const v3200 = files('/', [1024]).filter((p) => !p.endsWith('apparmor-profile'))
    expect(layoutProblems(v3200)).toEqual([
      `/opt/${product}/resources/apparmor-profile is missing`,
      'hicolor has 1024; missing 16, 24, 32, 48, 64, 128, 256, 512'
    ])
  })

  it('says so when there is no desktop entry to go by', () => {
    expect(layoutProblems([`/opt/${product}/${executable}`])).toEqual([
      'there is no desktop entry in /usr/share/applications'
    ])
  })
})
