import { describe, expect, it } from 'vitest'
import { x11Relaunch, X11_RELAUNCH_GUARD, xDisplayReachable } from './display-server'

const EXE = '/opt/Universal Video Downloader/universal-video-downloader'
const WAYLAND = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }

function decide(over: Partial<Parameters<typeof x11Relaunch>[0]> = {}): ReturnType<typeof x11Relaunch> {
  return x11Relaunch({
    platform: 'linux',
    packaged: true,
    execPath: EXE,
    argv: [EXE],
    env: WAYLAND,
    socketExists: (path) => path === '/tmp/.X11-unix/X0',
    ...over
  })
}

describe('x11Relaunch', () => {
  it('starts an ordinary launch on a Wayland session again on X11', () => {
    expect(decide()).toEqual({ command: EXE, args: ['--ozone-platform=x11'] })
  })

  it('keeps a link and the autostart flag, after the switch', () => {
    const link = 'https://example.com/watch?v=1&t=2'
    expect(decide({ argv: [EXE, link] })?.args).toEqual(['--ozone-platform=x11', link])
    expect(decide({ argv: [EXE, '--hidden'] })?.args).toEqual(['--ozone-platform=x11', '--hidden'])
    expect(decide({ argv: [EXE, '--', link] })?.args).toEqual(['--ozone-platform=x11', '--', link])
  })

  it('starts an AppImage from the file, not from its mount', () => {
    const env = { ...WAYLAND, APPIMAGE: '/home/someone/Apps/uvd.AppImage' }
    expect(decide({ env })?.command).toBe('/home/someone/Apps/uvd.AppImage')
  })

  it.each(['--ozone-platform=wayland', '--ozone-platform=x11', '--ozone-platform=headless', '--ozone-platform-hint=auto'])(
    'leaves %s alone, so a choice made outright wins and it cannot loop',
    (flag) => {
      expect(decide({ argv: [EXE, flag] })).toBeNull()
    }
  )

  it('does not touch the terminal command, with or without its own switch', () => {
    expect(decide({ argv: [EXE, '--ozone-platform=headless', '--cli', 'https://example.com/a'] })).toBeNull()
    expect(decide({ argv: [EXE, '--cli', 'https://example.com/a'] })).toBeNull()
  })

  it('stops at the guard even if a launcher lost the switch', () => {
    expect(decide({ env: { ...WAYLAND, [X11_RELAUNCH_GUARD]: '1' } })).toBeNull()
  })

  it.each(['win32', 'darwin'] as const)('does nothing on %s', (platform) => {
    expect(decide({ platform })).toBeNull()
  })

  it('does nothing when not installed, because the dev server follows its process', () => {
    expect(decide({ packaged: false })).toBeNull()
  })

  it('does nothing on an X11 session, even with a Wayland socket about', () => {
    expect(decide({ env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' } })).toBeNull()
    expect(decide({ env: { ...WAYLAND, XDG_SESSION_TYPE: 'x11' } })).toBeNull()
    expect(decide({ env: { DISPLAY: ':0' } })).toBeNull()
  })

  it('goes by the socket when the session type is missing', () => {
    expect(decide({ env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' } })).not.toBeNull()
  })

  it('stays on Wayland when there is no X server to go to', () => {
    expect(decide({ env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' } })).toBeNull()
    expect(decide({ env: { ...WAYLAND, DISPLAY: '' } })).toBeNull()
    expect(decide({ socketExists: () => false })).toBeNull()
  })
})

describe('xDisplayReachable', () => {
  const only = (socket: string) => (path: string) => path === socket

  it('finds the socket of a local display', () => {
    expect(xDisplayReachable(':1', only('/tmp/.X11-unix/X1'))).toBe(true)
    expect(xDisplayReachable(':1.0', only('/tmp/.X11-unix/X1'))).toBe(true)
    expect(xDisplayReachable('unix:1', only('/tmp/.X11-unix/X1'))).toBe(true)
    expect(xDisplayReachable(':1', only('/tmp/.X11-unix/X0'))).toBe(false)
  })

  it('takes a remote display on trust and an empty one as none', () => {
    expect(xDisplayReachable('host.example:10.0', () => false)).toBe(true)
    expect(xDisplayReachable('', () => true)).toBe(false)
    expect(xDisplayReachable(undefined, () => true)).toBe(false)
  })
})
