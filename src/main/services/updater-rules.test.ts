import { describe, expect, it } from 'vitest'
import {
  CHECK_EVERY,
  CHECK_RETRY,
  checkDue,
  installerSuffix,
  mayCheckInBackground,
  MAC_MINIMUM_DARWIN,
  offeredToThisMac,
  pickDownload,
  requiredDarwin,
  type ReleaseAsset
} from './updater-rules'

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)
const BASE = 'https://github.com/DenisHumen/Universal-Video-Downloader-/releases/download/v3.25.0'

/** The files a release carries, as release.yml uploads them. */
const ASSETS: ReleaseAsset[] = [
  'Universal-Video-Downloader-3.25.0-windows-x64-setup.exe',
  'Universal-Video-Downloader-3.25.0-windows-x64-setup.exe.blockmap',
  'Universal-Video-Downloader-3.25.0-mac-arm64.dmg',
  'Universal-Video-Downloader-3.25.0-mac-arm64.dmg.blockmap',
  'Universal-Video-Downloader-3.25.0-mac-arm64.zip',
  'Universal-Video-Downloader-3.25.0-mac-x64.dmg',
  'Universal-Video-Downloader-3.25.0-mac-x64.zip',
  'Universal-Video-Downloader-3.25.0-linux-amd64.deb',
  'Universal-Video-Downloader-3.25.0-linux-x86_64.rpm',
  'Universal-Video-Downloader-3.25.0-linux-x86_64.AppImage',
  'latest-mac.yml',
  'SHA256SUMS'
].map((name) => ({ name, browser_download_url: `${BASE}/${name}` }))

const file = (url: string | undefined): string | undefined => url?.slice(BASE.length + 1)

describe('pickDownload', () => {
  it('offers a Mac its own disk image, not the zip or the blockmap', () => {
    expect(file(pickDownload(ASSETS, { platform: 'darwin', arch: 'arm64' }))).toBe(
      'Universal-Video-Downloader-3.25.0-mac-arm64.dmg'
    )
    expect(file(pickDownload(ASSETS, { platform: 'darwin', arch: 'x64' }))).toBe(
      'Universal-Video-Downloader-3.25.0-mac-x64.dmg'
    )
  })

  it('offers the Apple silicon image to an Intel build running under Rosetta', () => {
    expect(file(pickDownload(ASSETS, { platform: 'darwin', arch: 'x64', translated: true }))).toBe(
      'Universal-Video-Downloader-3.25.0-mac-arm64.dmg'
    )
  })

  it('offers the .deb or the .rpm by the package this copy came from', () => {
    expect(file(pickDownload(ASSETS, { platform: 'linux', arch: 'x64', packageType: 'deb' }))).toBe(
      'Universal-Video-Downloader-3.25.0-linux-amd64.deb'
    )
    expect(file(pickDownload(ASSETS, { platform: 'linux', arch: 'x64', packageType: 'rpm' }))).toBe(
      'Universal-Video-Downloader-3.25.0-linux-x86_64.rpm'
    )
  })

  it('has no answer when the release lacks the file, so the caller opens the page', () => {
    const noIntel = ASSETS.filter((a) => !a.name.includes('mac-x64'))
    expect(pickDownload(noIntel, { platform: 'darwin', arch: 'x64' })).toBeUndefined()
    expect(pickDownload(ASSETS, { platform: 'linux', arch: 'arm64', packageType: 'deb' })).toBeUndefined()
    expect(pickDownload(undefined, { platform: 'darwin', arch: 'arm64' })).toBeUndefined()
  })

  it('has no answer for a copy that is not a known package', () => {
    expect(pickDownload(ASSETS, { platform: 'linux', arch: 'x64' })).toBeUndefined()
    expect(pickDownload(ASSETS, { platform: 'linux', arch: 'x64', packageType: 'pacman' })).toBeUndefined()
    expect(pickDownload(ASSETS, { platform: 'win32', arch: 'x64' })).toBeUndefined()
  })

  it('ignores a link that is not https', () => {
    const odd = [{ name: 'x-mac-arm64.dmg', browser_download_url: 'http://example.com/x-mac-arm64.dmg' }]
    expect(pickDownload(odd, { platform: 'darwin', arch: 'arm64' })).toBeUndefined()
  })
})

describe('installerSuffix', () => {
  it('names the files the way release.yml links them', () => {
    expect(installerSuffix({ platform: 'linux', arch: 'x64', packageType: 'deb' })).toBe('-linux-amd64.deb')
    expect(installerSuffix({ platform: 'linux', arch: 'x64', packageType: 'rpm' })).toBe('-linux-x86_64.rpm')
  })
})

describe('mayCheckInBackground', () => {
  it('leaves a download in progress, a pending restart and a running check alone', () => {
    expect(mayCheckInBackground('downloading')).toBe(false)
    expect(mayCheckInBackground('downloaded')).toBe(false)
    expect(mayCheckInBackground('checking')).toBe(false)
  })

  it('looks again from every other state, an old offer included', () => {
    for (const state of ['idle', 'not-available', 'error', 'available'] as const) {
      expect(mayCheckInBackground(state)).toBe(true)
    }
  })
})

describe('checkDue', () => {
  it('is due when nothing has been checked yet', () => {
    expect(checkDue(NOW, 0, 0)).toBe(true)
  })

  it('waits six hours after an answer', () => {
    expect(checkDue(NOW, NOW - CHECK_EVERY + 60_000, NOW - CHECK_EVERY + 60_000)).toBe(false)
    expect(checkDue(NOW, NOW - CHECK_EVERY, NOW - CHECK_EVERY)).toBe(true)
  })

  it('retries an unanswered check after half an hour, not six', () => {
    const answered = NOW - 2 * CHECK_EVERY
    expect(checkDue(NOW, answered, NOW - CHECK_RETRY + 60_000)).toBe(false)
    expect(checkDue(NOW, answered, NOW - CHECK_RETRY)).toBe(true)
  })

  it('does not let a clock moved back hold checks off', () => {
    expect(checkDue(NOW, NOW + 24 * CHECK_EVERY, 0)).toBe(true)
  })
})

describe('the macOS a release needs', () => {
  const NOTES = 'Electron 45 underneath.\n\nRequires macOS 13 or later.\n'

  it('reads it from the release notes as a Darwin major', () => {
    expect(requiredDarwin(NOTES)).toBe(22)
    expect(requiredDarwin('requires macOS 12.0 or later')).toBe(21)
    expect(requiredDarwin('Fixes a crash on macOS 13.')).toBeUndefined()
    expect(requiredDarwin(undefined)).toBeUndefined()
  })

  it('is what this build needs: Electron 45 runs on macOS 13 and later', () => {
    expect(MAC_MINIMUM_DARWIN).toBe(22)
  })

  // macOS 11 is Darwin 20, 12 is 21, 13 is 22.
  it('is not offered to a Mac older than that', () => {
    expect(offeredToThisMac('20.6.0', NOTES)).toBe(false)
    expect(offeredToThisMac('21.6.0', NOTES)).toBe(false)
    expect(offeredToThisMac('22.1.0', NOTES)).toBe(true)
    expect(offeredToThisMac('25.0.0', NOTES)).toBe(true)
  })

  it('is offered as before when the notes do not say, or the OS cannot be read', () => {
    expect(offeredToThisMac('20.6.0', 'Bug fixes.')).toBe(true)
    expect(offeredToThisMac('', NOTES)).toBe(true)
  })
})
