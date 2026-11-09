/**
 * Telling the system that `uvd:` links are this app's.
 *
 * On Windows that is a registry entry under the current user, and it names the
 * executable that asked. So only an installed app ever asks: a development run
 * or a test would leave the system starting a checkout's Electron for every
 * `uvd:` link, on a machine that may have the real app on it too.
 *
 * Not on Linux, where the packages' desktop entries say it (`protocols` in
 * electron-builder.yml) and the install script refreshes the list they are read
 * from. The call there would run `xdg-settings` on every launch, and an AppImage
 * that nobody integrated has no desktop entry for it to name: links then do
 * nothing there, which is what the Help page says, and nothing breaks.
 */
export const LINK_SCHEME = 'uvd'

/** Set by anything that runs a packaged build without installing it. */
export const NO_PROTOCOL_ENV = 'UVD_NO_PROTOCOL_REGISTRATION'

export function shouldClaimLinkScheme(state: { packaged: boolean; platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): boolean {
  const { packaged, platform, env } = state
  if (!packaged || env['NODE_ENV'] === 'test' || env['VITEST'] || env[NO_PROTOCOL_ENV]) return false
  return platform === 'win32' || platform === 'darwin'
}

interface Registrar {
  isDefaultProtocolClient: (scheme: string) => boolean
  setAsDefaultProtocolClient: (scheme: string) => boolean
}

/**
 * Claim the scheme if this launch may, and it isn't this app's already: an
 * update can move the executable, and then the old entry no longer leads here.
 * No extra arguments: Electron refuses to start with anything after a link on
 * the command line (CVE-2018-1000006), and a `--` here would turn that off.
 */
export function claimLinkScheme(app: Registrar, state: Parameters<typeof shouldClaimLinkScheme>[0]): boolean {
  if (!shouldClaimLinkScheme(state) || app.isDefaultProtocolClient(LINK_SCHEME)) return false
  return app.setAsDefaultProtocolClient(LINK_SCHEME)
}
