import { describe, expect, it } from 'vitest'
import { translate, type TranslateFn } from '../i18n'
import { describeCliCommand } from './cliCommand'

const en: TranslateFn = (key, vars) => translate('en', key, vars)
const ru: TranslateFn = (key, vars) => translate('ru', key, vars)

describe('describeCliCommand', () => {
  it('hides the row on Windows and until main has answered', () => {
    expect(describeCliCommand(null, en)).toBeNull()
    expect(describeCliCommand({ method: 'none', installed: false }, en)).toBeNull()
  })

  it('only reports in development and for a package install', () => {
    expect(describeCliCommand({ method: 'development', installed: false }, en)).toMatchObject({
      install: false,
      hint: expect.stringMatching(/development run/)
    })
    const pkg = describeCliCommand({ method: 'package', installed: true, path: '/usr/bin/uvd' }, en)
    expect(pkg).toEqual({
      install: false,
      disabled: false,
      hint: 'installed with the app at /usr/bin/uvd. uvd <link> in a terminal downloads without opening the window; uvd --help lists the options.'
    })
    expect(describeCliCommand({ method: 'package', installed: false, path: '/usr/bin/uvd' }, en)?.hint).toMatch(
      /isn’t there now/
    )
  })

  it('offers to link it on a Mac, and stops offering once it is there', () => {
    expect(describeCliCommand({ method: 'link', installed: false, path: '/usr/local/bin/uvd' }, en)).toEqual({
      install: true,
      disabled: false,
      hint: 'put uvd in /usr/local/bin, and uvd <link> in a terminal downloads without opening the window.'
    })
    expect(describeCliCommand({ method: 'link', installed: true, path: '/usr/local/bin/uvd' }, en)).toMatchObject({
      install: false,
      hint: expect.stringMatching(/^installed at \/usr\/local\/bin\/uvd\./)
    })
  })

  it('warns before replacing somebody else’s uvd', () => {
    const row = describeCliCommand({ method: 'link', installed: false, occupied: true, path: '/usr/local/bin/uvd' }, en)
    expect(row).toMatchObject({ install: true, disabled: false })
    expect(row?.hint).toMatch(/already a different program called uvd/)
  })

  it('will not link an app still running from the disk image', () => {
    const row = describeCliCommand({ method: 'link', installed: false, temporary: true, path: '/usr/local/bin/uvd' }, en)
    expect(row).toMatchObject({ install: true, disabled: true })
    expect(row?.hint).toMatch(/move it to Applications/)
  })

  it('says when an AppImage’s folder is not on the PATH, before installing and after', () => {
    const path = '/home/me/.local/bin/uvd'
    const before = describeCliCommand({ method: 'script', installed: false, onPath: false, path }, en)
    expect(before?.hint).toMatch(/window\. \/home\/me\/\.local\/bin isn’t on your PATH yet/)
    const after = describeCliCommand({ method: 'script', installed: true, onPath: false, path }, en)
    expect(after?.hint).toMatch(/lists the options\. \/home\/me\/\.local\/bin isn’t on your PATH yet/)
    const fine = describeCliCommand({ method: 'script', installed: true, onPath: true, path }, en)
    expect(fine?.hint).not.toMatch(/PATH/)
  })

  it('speaks Russian too', () => {
    expect(describeCliCommand({ method: 'link', installed: false, path: '/usr/local/bin/uvd' }, ru)?.hint).toBe(
      'поставьте uvd в /usr/local/bin, и команда uvd <ссылка> в терминале будет скачивать, не открывая окна.'
    )
  })
})
