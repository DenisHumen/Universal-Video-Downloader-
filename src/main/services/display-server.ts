/**
 * Which display server the app runs on, on Linux.
 *
 * Electron defaults to native Wayland, and there grabbing the header bar throws
 * the window aside with the pointer in its corner. On the real Ubuntu machine
 * it was reported on, `XDG_SESSION_TYPE` was wayland, the drag jumped, and
 * `--ozone-platform=x11` stopped it. On GNOME 46 at 100% the same jump measures
 * for any window hidden and shown again, the tray's way (Electron 44 to 46, frame
 * or no frame): the new toplevel's geometry is sent before it has a buffer,
 * Mutter clips that to 0x0, Chromium never sends it again, and a drag then keeps
 * the pointer on a corner of nothing. So a Wayland session runs this app through
 * XWayland, at the price of a blurrier window under fractional scaling (the page
 * renders at 1x and is stretched); somebody who prefers native Wayland passes
 * `--ozone-platform=wayland` and keeps it.
 *
 * It has to be a new process: measured on Electron 45, Ozone is up before main
 * runs. `app.commandLine.appendSwitch` at the top of main leaves the browser on
 * Wayland and only the GPU process on X11, and no window ever appears. Changing
 * the environment there makes the app exit with code 1. And
 * `linux.executableArgs` would only cover a launch from the .desktop file.
 *
 * A plain spawn rather than `app.relaunch`: its helper runs from the binary this
 * process runs from, and with an AppImage's mount taken away behind it nothing
 * ever started again, leaving no window at all. Waiting for this process to end
 * is what the helper is for, and nothing here needs that: no lock is held yet.
 */

/** Set for the relaunched process, so that a launcher losing its arguments cannot loop. */
export const X11_RELAUNCH_GUARD = 'UVD_X11_RELAUNCHED'

const OZONE_SWITCH = '--ozone-platform'
const X11_SWITCH = `${OZONE_SWITCH}=x11`

/**
 * Whether `DISPLAY` leads anywhere. X11 with no server behind it does not fall
 * back to anything: Electron exits, and a person is left with no window. A
 * remote display (`host:10.0`) cannot be checked from here and gets the benefit
 * of the doubt, as it does from any other X client.
 */
export function xDisplayReachable(display: string | undefined, socketExists: (path: string) => boolean): boolean {
  if (!display) return false
  const local = /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(display)
  return local ? socketExists(`/tmp/.X11-unix/X${local[1]}`) : true
}

function waylandSession(env: NodeJS.ProcessEnv): boolean {
  const session = env['XDG_SESSION_TYPE']
  // An autostart or a terminal can come without the session type; the socket's name still says.
  return session === 'wayland' || (session !== 'x11' && Boolean(env['WAYLAND_DISPLAY']))
}

/**
 * What to run to start this app again on X11, or null to carry on.
 *
 * Only an installed app: `electron-vite dev` follows the process it started and
 * stops when that one exits. `--cli` has no window to move and is never
 * relaunched, whether `uvd` started it (it passes `--ozone-platform=headless`)
 * or somebody ran the AppImage with `--cli` by hand.
 */
export function x11Relaunch(state: {
  platform: NodeJS.Platform
  packaged: boolean
  execPath: string
  argv: string[]
  env: NodeJS.ProcessEnv
  socketExists: (path: string) => boolean
}): { command: string; args: string[] } | null {
  const { platform, packaged, execPath, argv, env, socketExists } = state
  if (platform !== 'linux' || !packaged) return null
  if (env[X11_RELAUNCH_GUARD]) return null
  // Any choice somebody made outright, hint included, stands.
  if (argv.some((arg) => arg === '--cli' || arg.startsWith(OZONE_SWITCH))) return null
  if (!waylandSession(env) || !xDisplayReachable(env['DISPLAY'], socketExists)) return null
  return {
    // An AppImage's own binary lives on a mount that goes away with this process; the file itself is what starts again.
    command: env['APPIMAGE'] || execPath,
    // In front: Chromium stops reading switches at a bare `--`, and everything else (a link, `--hidden`) stays as it came.
    args: [X11_SWITCH, ...argv.slice(1)]
  }
}
