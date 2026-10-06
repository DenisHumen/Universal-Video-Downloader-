/**
 * The parts of start-with-system that can be decided without Electron.
 */
import type { AppSettings } from '@shared/types'

/**
 * The argument a launch at login carries, so the app can tell it apart from
 * somebody opening it. Windows and Linux pass it; macOS gives a login item no
 * arguments at all, which is why `shouldStartHidden` also takes its own flag.
 */
export const HIDDEN_FLAG = '--hidden'

/**
 * Whether the start-with-system setting has to be written out again.
 *
 * Settings are applied on every change to any of them, and applying this one
 * is not free: it rewrites the login item, or on Linux the `.desktop` file in
 * `~/.config/autostart`, and doing that because somebody typed a character
 * into the filename template is churn for nothing. Only a change is worth
 * acting on — and the first call of a session, when nothing has been applied
 * yet. That one matters: an AppImage's path changes with every update, so the
 * entry is refreshed once per launch.
 */
export function autostartNeedsApplying(wanted: boolean, applied: boolean | undefined): boolean {
  return applied === undefined || wanted !== applied
}

/**
 * The `Exec` line's value for the Linux autostart entry.
 *
 * The path used to go in bare, and the Desktop Entry spec splits `Exec` at
 * spaces. A .deb or .rpm installs to `/opt/Universal Video Downloader/`, so
 * every login tried to run a program called `/opt/Universal` and nothing
 * started at all.
 *
 * The spec quotes in two layers, applied in this order. First the command
 * line: the path goes in double quotes, with `"`, `` ` ``, `$` and `\` inside
 * them escaped by a backslash. Then the escaping every string value in the
 * file gets, which doubles each backslash again - so a single backslash in a
 * path is four in the file - and spells control characters out, since a raw
 * newline would end the line. A `%` is doubled last, or it would read as a
 * field code such as `%u`.
 */
export function desktopExec(target: string): string {
  const quoted = '"' + target.replace(/(["`$\\])/g, '\\$1') + '"'
  const value = quoted
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/%/g, '%%')
  return `${value} ${HIDDEN_FLAG}`
}

/** The whole `~/.config/autostart` entry that launches `target` at login. */
export function autostartDesktopEntry(target: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Universal Video Downloader',
    `Exec=${desktopExec(target)}`,
    'Icon=universal-video-downloader',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/**
 * Whether this launch should stay in the tray instead of opening the window.
 *
 * A launch at login used to open the full window every time, including for
 * the people who keep the app in the tray precisely so that it stays out of
 * the way. It is a launch at login when the login item's argument is on the
 * command line, or when macOS says so.
 *
 * Hidden needs something to come back through, though. With neither the tray
 * nor background watching on (the second implies the tray) there is no icon,
 * and a hidden start would be a process nobody can see or quit - so those
 * launches open the window as they always did.
 */
export function shouldStartHidden(
  argv: readonly string[],
  settings: Pick<AppSettings, 'trayEnabled' | 'automationEnabled'>,
  wasOpenedAtLogin: boolean
): boolean {
  const atLogin = wasOpenedAtLogin || argv.includes(HIDDEN_FLAG)
  return atLogin && (settings.trayEnabled || settings.automationEnabled)
}
