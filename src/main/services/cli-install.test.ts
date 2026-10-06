import { describe, expect, it } from 'vitest'
import {
  appImageScript,
  appleScriptString,
  classifyLink,
  cliPlan,
  dirOnPath,
  isOurScript,
  isTemporaryLocation,
  isUserCancel,
  macInstallCommand,
  macInstallScript,
  PACKAGE_TARGET,
  scriptUpkeep,
  shellQuote,
  SCRIPT_MARKER
} from './cli-install'

const MAC_WRAPPER = '/Applications/Universal Video Downloader.app/Contents/Resources/bin/uvd'

describe('cliPlan', () => {
  const base = { packaged: true, hasWrapper: true }

  it('shows nothing on Windows, even in development', () => {
    expect(cliPlan({ ...base, platform: 'win32' })).toBe('none')
    expect(cliPlan({ ...base, platform: 'win32', packaged: false })).toBe('none')
  })

  it('says a development run has nothing to install', () => {
    expect(cliPlan({ ...base, platform: 'darwin', packaged: false })).toBe('development')
    expect(cliPlan({ ...base, platform: 'linux', packaged: false, appImage: '/tmp/a.AppImage' })).toBe('development')
  })

  it('links on a Mac, as long as the build carries the script', () => {
    expect(cliPlan({ ...base, platform: 'darwin' })).toBe('link')
    expect(cliPlan({ ...base, platform: 'darwin', hasWrapper: false })).toBe('none')
  })

  it('leaves the command to the package that installed it', () => {
    for (const packageType of ['deb', 'rpm', 'pacman', 'deb\n']) {
      expect(cliPlan({ ...base, platform: 'linux', packageType })).toBe('package')
    }
  })

  it('writes a script for an AppImage, and does nothing for an unknown install', () => {
    expect(cliPlan({ ...base, platform: 'linux', appImage: '/home/me/uvd.AppImage' })).toBe('script')
    expect(cliPlan({ ...base, platform: 'linux' })).toBe('none')
    expect(cliPlan({ ...base, platform: 'linux', packageType: 'snap' })).toBe('none')
  })
})

describe('quoting', () => {
  it('keeps any path one literal shell word', () => {
    expect(shellQuote('/opt/a b')).toBe(`'/opt/a b'`)
    expect(shellQuote(`/Users/me/Bob's Apps`)).toBe(`'/Users/me/Bob'\\''s Apps'`)
    expect(shellQuote('$HOME `x` "y" \\z')).toBe(`'$HOME \`x\` "y" \\z'`)
  })

  it('escapes only what AppleScript reads inside a string', () => {
    expect(appleScriptString('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"')
    expect(appleScriptString(`it's`)).toBe(`"it's"`)
  })
})

describe('the macOS install', () => {
  it('makes the folder and the link, with every path quoted for the shell', () => {
    expect(macInstallCommand(MAC_WRAPPER)).toBe(
      `mkdir -p '/usr/local/bin' && ln -sfn '${MAC_WRAPPER}' '/usr/local/bin/uvd'`
    )
  })

  it('wraps the command for AppleScript and asks as administrator', () => {
    expect(macInstallScript(MAC_WRAPPER, 'Allow it.')).toBe(
      `do shell script "mkdir -p '/usr/local/bin' && ln -sfn '${MAC_WRAPPER}' '/usr/local/bin/uvd'"` +
        ' with prompt "Allow it." with administrator privileges'
    )
  })

  it('survives an app folder with quotes and backslashes in its name', () => {
    const wrapper = `/Users/me/Bob's "Tools" \\ old/UVD.app/Contents/Resources/bin/uvd`
    const script = macInstallScript(wrapper, 'Say "please".')
    // The shell sees: ln -sfn '/Users/me/Bob'\''s "Tools" \ old/...'
    // and AppleScript sees that with every \ and " escaped once more.
    expect(script).toBe(
      'do shell script "mkdir -p \'/usr/local/bin\' && ln -sfn ' +
        `'/Users/me/Bob'\\\\''s \\"Tools\\" \\\\ old/UVD.app/Contents/Resources/bin/uvd'` +
        ` '/usr/local/bin/uvd'" with prompt "Say \\"please\\"." with administrator privileges`
    )
  })

  it('tells a dismissed password prompt from a failure', () => {
    expect(isUserCancel('0:113: execution error: User canceled. (-128)')).toBe(true)
    expect(isUserCancel('execution error: User cancelled.')).toBe(true)
    expect(isUserCancel('execution error: ln: /usr/local/bin/uvd: Operation not permitted (1)')).toBe(false)
    expect(isUserCancel('')).toBe(false)
  })

  it('will not link an app that is about to disappear', () => {
    expect(isTemporaryLocation('/Volumes/Universal Video Downloader/Universal Video Downloader.app/Contents/Resources/bin/uvd')).toBe(true)
    expect(
      isTemporaryLocation('/private/var/folders/xy/T/AppTranslocation/1A2B/d/UVD.app/Contents/Resources/bin/uvd')
    ).toBe(true)
    expect(isTemporaryLocation(MAC_WRAPPER)).toBe(false)
    expect(isTemporaryLocation('/Users/me/Applications/UVD.app/Contents/Resources/bin/uvd')).toBe(false)
  })

  it('reads what the link in /usr/local/bin points at', () => {
    expect(classifyLink(MAC_WRAPPER, '/usr/local/bin/uvd', MAC_WRAPPER)).toBe('ours')
    // A relative link that lands on the same file.
    expect(
      classifyLink('../../../Applications/Universal Video Downloader.app/Contents/Resources/bin/uvd', '/usr/local/bin/uvd', MAC_WRAPPER)
    ).toBe('ours')
    // The app before it was moved to Applications: repoint it, it is not somebody else's.
    expect(
      classifyLink('/Users/me/Downloads/Universal Video Downloader.app/Contents/Resources/bin/uvd', '/usr/local/bin/uvd', MAC_WRAPPER)
    ).toBe('stale')
    expect(classifyLink('/opt/homebrew/Cellar/uvd/1.0/bin/uvd', '/usr/local/bin/uvd', MAC_WRAPPER)).toBe('foreign')
  })
})

describe('the AppImage script', () => {
  const appImage = '/home/me/Applications/Universal Video Downloader-3.24.0-linux-x86_64.AppImage'

  it('starts the AppImage with --cli and the arguments as given', () => {
    const script = appImageScript(appImage)
    expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    expect(script).toContain(`app='${appImage}'`)
    expect(script).toContain('exec "$app" --cli "$@"')
    expect(script).toContain('exec "$app" --ozone-platform=headless --cli "$@"')
    expect(script.endsWith('\n')).toBe(true)
    expect(script).not.toContain('\r')
  })

  it('looks for the version an update put beside it', () => {
    expect(appImageScript(appImage)).toContain(
      `for candidate in '/home/me/Applications/Universal Video Downloader-'*'-linux-x86_64.AppImage'; do`
    )
    expect(appImageScript('/home/me/UVD-3.25.0-beta.2-linux-x86_64.AppImage')).toContain(
      `for candidate in '/home/me/UVD-'*'-linux-x86_64.AppImage'; do`
    )
  })

  it('has nothing to look for when the name carries no version', () => {
    // The updater overwrites such a file in place, so its path never changes.
    const script = appImageScript('/home/me/Applications/Universal-Video-Downloader.AppImage')
    expect(script).not.toContain('for candidate')
  })

  it('hands over to the package’s uvd once the AppImage is gone, before giving up', () => {
    for (const path of [appImage, '/home/me/Applications/Universal-Video-Downloader.AppImage']) {
      const script = appImageScript(path)
      const handOver = script.indexOf(`[ -x '${PACKAGE_TARGET}' ] && exec '${PACKAGE_TARGET}' "$@"`)
      expect(handOver).toBeGreaterThan(-1)
      // After the search for an updated AppImage, which should win when there is one,
      // and before the error, which it exists to prevent.
      expect(handOver).toBeGreaterThan(script.indexOf('if [ ! -x "$app" ]; then'))
      expect(handOver).toBeLessThan(script.indexOf('echo "uvd: Universal Video Downloader is no longer at'))
      if (script.includes('for candidate')) expect(handOver).toBeGreaterThan(script.indexOf('done'))
    }
  })

  it('quotes a path the shell would otherwise split or expand', () => {
    const script = appImageScript(`/home/me/it's $HOME/UVD-3.24.0-linux-x86_64.AppImage`)
    expect(script).toContain(`app='/home/me/it'\\''s $HOME/UVD-3.24.0-linux-x86_64.AppImage'`)
    expect(script).toContain(`for candidate in '/home/me/it'\\''s $HOME/UVD-'*'-linux-x86_64.AppImage'; do`)
  })

  it('is recognisable as the app’s own, and only then', () => {
    expect(isOurScript(appImageScript(appImage))).toBe(true)
    expect(isOurScript(appImageScript(appImage).replace(/\n/g, '\r\n'))).toBe(true)
    expect(isOurScript('#!/bin/sh\nexec /opt/other/uvd "$@"\n')).toBe(false)
    expect(isOurScript(`#!/bin/sh\necho "${SCRIPT_MARKER}"\n`)).toBe(false)
  })
})

describe('scriptUpkeep', () => {
  const appImage = '/home/me/Applications/Universal Video Downloader-3.25.0-linux-x86_64.AppImage'
  const older = appImageScript('/home/me/Applications/Universal Video Downloader-3.24.0-linux-x86_64.AppImage')
  const foreign = '#!/bin/sh\nexec /opt/other/uvd "$@"\n'

  it('points an AppImage’s script at the file that is running', () => {
    expect(scriptUpkeep({ method: 'script', appImage, scriptText: older, packageLinked: false })).toBe('rewrite')
    expect(
      scriptUpkeep({ method: 'script', appImage, scriptText: appImageScript(appImage), packageLinked: false })
    ).toBe('keep')
  })

  it('deletes the AppImage’s script once a package has put its own uvd in place', () => {
    // The scenario: tried the AppImage, installed the command, then moved to the .deb.
    expect(scriptUpkeep({ method: 'package', scriptText: older, packageLinked: true })).toBe('remove')
    // Even when that AppImage is still there: the package's command is the one Settings reports.
    expect(scriptUpkeep({ method: 'package', appImage, scriptText: appImageScript(appImage), packageLinked: true })).toBe(
      'remove'
    )
  })

  it('keeps the script while the package’s own command is missing', () => {
    // Somebody removed /usr/bin/uvd; the script may be the only `uvd` that still works.
    expect(scriptUpkeep({ method: 'package', scriptText: older, packageLinked: false })).toBe('keep')
  })

  it('never touches a uvd the app did not write, or nothing at all', () => {
    for (const method of ['script', 'package'] as const) {
      expect(scriptUpkeep({ method, appImage, scriptText: foreign, packageLinked: true })).toBe('keep')
      expect(scriptUpkeep({ method, appImage, scriptText: undefined, packageLinked: true })).toBe('keep')
      // A file too large to read comes back as no text at all.
      expect(scriptUpkeep({ method, appImage, scriptText: '', packageLinked: true })).toBe('keep')
    }
  })

  it('leaves the script alone on a Mac, in development and on an unknown install', () => {
    for (const method of ['link', 'development', 'none'] as const) {
      expect(scriptUpkeep({ method, appImage, scriptText: older, packageLinked: true })).toBe('keep')
    }
    // An AppImage run that somehow lost its path has nothing to point the script at.
    expect(scriptUpkeep({ method: 'script', scriptText: older, packageLinked: false })).toBe('keep')
  })
})

describe('dirOnPath', () => {
  const home = '/home/me'

  it('finds the folder however the PATH spells it', () => {
    expect(dirOnPath('/home/me/.local/bin', '/usr/bin:/home/me/.local/bin', home)).toBe(true)
    expect(dirOnPath('/home/me/.local/bin', '/home/me/.local/bin/:/usr/bin', home)).toBe(true)
    expect(dirOnPath('/home/me/.local/bin', '~/.local/bin:/usr/bin', home)).toBe(true)
    expect(dirOnPath('/home/me/.local/bin', '$HOME/.local/bin', home)).toBe(true)
  })

  it('does not mistake a neighbour for it', () => {
    expect(dirOnPath('/home/me/.local/bin', '/usr/local/bin:/usr/bin:/bin', home)).toBe(false)
    expect(dirOnPath('/home/me/.local/bin', '/home/me/.local/bin2', home)).toBe(false)
    expect(dirOnPath('/home/me/.local/bin', '~other/.local/bin', home)).toBe(false)
    expect(dirOnPath('/home/me/.local/bin', undefined, home)).toBe(false)
    expect(dirOnPath('/home/me/.local/bin', '', home)).toBe(false)
  })
})
