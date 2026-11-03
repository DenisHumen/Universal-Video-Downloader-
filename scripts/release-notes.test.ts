import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MAC_MINIMUM_DARWIN, offeredToThisMac, requiredDarwin } from '../src/main/services/updater-rules'

/*
  E3b / L4: the first Electron 45 release must say which macOS it needs, and
  say it twice in release.yml - at draft creation and in the (continue-on-
  error) body step - so a failed body step cannot drop it. 13.0 was read from
  a packed Electron 45 app: the stock Electron.app Info.plist, our packed
  Info.plist (electron-builder.yml minimumSystemVersion) and the Mach-O
  LC_BUILD_VERSION minos of the main binary and Electron Framework.
*/

const yml = readFileSync(join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf-8')
const builder = readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf-8')
const LINE = 'Requires macOS 13 or later.'

describe('the macOS floor in the release notes', () => {
  it('is written at draft creation and again in the body step', () => {
    expect(yml).toMatch(/gh release create[^\n]*--notes "Requires macOS 13 or later\."/)
    expect(yml).toContain(`echo "${LINE}"`)
  })

  it('agrees with the packed app and with what the updater reads back', () => {
    expect(builder).toMatch(/minimumSystemVersion: '13\.0'/)
    expect(requiredDarwin(LINE)).toBe(MAC_MINIMUM_DARWIN)
    expect(offeredToThisMac('21.6.0', LINE)).toBe(false)
    expect(offeredToThisMac('22.1.0', LINE)).toBe(true)
  })
})
