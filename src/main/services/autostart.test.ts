import { describe, expect, it } from 'vitest'
import {
  autostartDesktopEntry,
  autostartNeedsApplying,
  desktopExec,
  HIDDEN_FLAG,
  shouldStartHidden
} from './autostart'

/*
  The switch used to take effect one launch late, because it was applied only
  at startup. Applying it on every settings change instead would rewrite the
  login item each time any setting moved, so it is applied on a change only.
*/

describe('autostartNeedsApplying', () => {
  it('applies at launch, when nothing has been applied yet this session', () => {
    expect(autostartNeedsApplying(true, undefined)).toBe(true)
    expect(autostartNeedsApplying(false, undefined)).toBe(true)
  })

  it('applies when the switch is flipped mid-session', () => {
    expect(autostartNeedsApplying(true, false)).toBe(true)
    expect(autostartNeedsApplying(false, true)).toBe(true)
  })

  it('leaves the login item alone when some other setting changed', () => {
    expect(autostartNeedsApplying(true, true)).toBe(false)
    expect(autostartNeedsApplying(false, false)).toBe(false)
  })
})

/*
  How a desktop environment turns an Exec value back into a command line, in
  the order GLib does it: the key file's string escapes, then field codes,
  then shell-style splitting where double quotes protect spaces and a
  backslash inside them escapes `"`, `` ` ``, `$` and itself.
*/
function parseExec(value: string): string[] {
  const unescaped = value.replace(/\\([sntr\\])/g, (_m, c: string) =>
    c === 's' ? ' ' : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'
  )
  const expanded = unescaped.replace(/%%/g, '%')
  const args: string[] = []
  let current = ''
  let quoted = false
  let started = false
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i]
    if (quoted) {
      if (ch === '\\' && '"`$\\'.includes(expanded[i + 1] ?? '')) current += expanded[++i]
      else if (ch === '"') quoted = false
      else current += ch
    } else if (ch === '"') {
      quoted = true
      started = true
    } else if (ch === ' ') {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

describe('desktopExec', () => {
  // The .deb and .rpm install path has spaces in it, and Exec was written
  // bare, so every login ran a program called /opt/Universal.
  it('quotes a path with spaces so it stays one program', () => {
    expect(desktopExec('/opt/Universal Video Downloader/universal-video-downloader')).toBe(
      '"/opt/Universal Video Downloader/universal-video-downloader" --hidden'
    )
  })

  it('escapes the characters the spec reserves inside quotes, at both layers', () => {
    expect(desktopExec('/home/u/$HOME/uvd.AppImage')).toBe('"/home/u/\\\\$HOME/uvd.AppImage" --hidden')
    expect(desktopExec('/home/u/my "apps"/uvd')).toBe('"/home/u/my \\\\"apps\\\\"/uvd" --hidden')
    expect(desktopExec('/home/u/a`b/uvd')).toBe('"/home/u/a\\\\`b/uvd" --hidden')
    // One backslash in the path is four in the file.
    expect(desktopExec('/home/u/back\\slash/uvd')).toBe('"/home/u/back\\\\\\\\slash/uvd" --hidden')
  })

  it('doubles a percent sign so it is not read as a field code', () => {
    expect(desktopExec('/home/u/100%u/uvd')).toBe('"/home/u/100%%u/uvd" --hidden')
  })

  it('spells out a newline rather than ending the line with it', () => {
    expect(desktopExec('/home/u/a\nb/uvd')).toBe('"/home/u/a\\nb/uvd" --hidden')
  })

  it('reads back as exactly the path and the hidden flag, however odd the path', () => {
    const paths = [
      '/opt/Universal Video Downloader/universal-video-downloader',
      '/home/u/Applications/Universal Video Downloader-3.20.0.AppImage',
      '/home/u/$x "y" `z` \\w %f 100%/it\'s; (a|b) & ~#*?<>.AppImage',
      '/home/u/tab\there/new\nline/uvd'
    ]
    for (const path of paths) {
      expect(parseExec(desktopExec(path))).toEqual([path, HIDDEN_FLAG])
    }
  })
})

describe('autostartDesktopEntry', () => {
  it('writes a complete entry that launches hidden and opens no terminal', () => {
    const entry = autostartDesktopEntry('/opt/Universal Video Downloader/universal-video-downloader')
    expect(entry.split('\n')).toEqual([
      '[Desktop Entry]',
      'Type=Application',
      'Name=Universal Video Downloader',
      'Exec="/opt/Universal Video Downloader/universal-video-downloader" --hidden',
      'Icon=universal-video-downloader',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      ''
    ])
  })
})

/*
  A launch at login opened the full window every time, even for people who
  keep the app in the tray. Staying hidden is only safe while there is an icon
  to come back through.
*/
describe('shouldStartHidden', () => {
  const tray = { trayEnabled: true, automationEnabled: false }
  const watching = { trayEnabled: false, automationEnabled: true }
  const neither = { trayEnabled: false, automationEnabled: false }
  const exe = 'C:\\Program Files\\Universal Video Downloader\\Universal Video Downloader.exe'

  it('stays in the tray when Windows or Linux launches it at login', () => {
    expect(shouldStartHidden([exe, HIDDEN_FLAG], tray, false)).toBe(true)
    expect(shouldStartHidden([exe, HIDDEN_FLAG], watching, false)).toBe(true)
  })

  it('stays in the tray when macOS says it was opened at login', () => {
    expect(shouldStartHidden([exe], tray, true)).toBe(true)
    expect(shouldStartHidden([exe], watching, true)).toBe(true)
  })

  it('opens the window anyway when there would be no icon to bring it back', () => {
    expect(shouldStartHidden([exe, HIDDEN_FLAG], neither, false)).toBe(false)
    expect(shouldStartHidden([exe], neither, true)).toBe(false)
  })

  it('opens the window when somebody starts the app themselves', () => {
    expect(shouldStartHidden([exe], tray, false)).toBe(false)
    expect(shouldStartHidden([exe, 'https://example.com/watch?v=1'], watching, false)).toBe(false)
  })
})
