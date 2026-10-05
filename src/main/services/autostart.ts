/**
 * The parts of start-with-system that can be decided without Electron.
 */

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
