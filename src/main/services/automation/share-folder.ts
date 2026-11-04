import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import type { PickedShare } from '@shared/automation'

/**
 * Which share a folder picked in the system dialog lives on.
 *
 * The app speaks SMB itself, so what it needs is a server, a share and a
 * folder - not the local path the dialog answers with. But every desktop
 * already knows how to get to a share: Files, Finder and Explorer all browse
 * the network and mount what they open. So the dialog does the finding, and
 * this works back from where the OS put the share to where it really is.
 *
 *  - GNOME (gvfs): /run/user/1000/gvfs/smb-share:server=nas,share=video,user=me/series
 *  - KDE (kio-fuse): /run/user/1000/kio-fuse-AbCd/smb/me@nas/video/series
 *  - a cifs mount, from /proc/mounts: //nas/video on /mnt/nas
 *  - macOS, from `mount`: //me@nas/video on /Volumes/video (smbfs, ...)
 *  - Windows: a UNC path as it is, or a mapped drive from `net use`
 *
 * The login comes along when the OS kept one, so the form can fill it in.
 */

const BACKSLASH = String.fromCharCode(92)

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const clean = (parts: string[]): string[] => parts.filter(Boolean)

/** `user`, `DOMAIN;user` or `DOMAIN\user`, with any password after a colon dropped. */
function splitUser(raw: string): { username?: string; domain?: string } {
  const user = decode(raw.split(':')[0])
  const at = Math.max(user.indexOf(';'), user.indexOf(BACKSLASH))
  if (at > 0) return { domain: user.slice(0, at), username: user.slice(at + 1) || undefined }
  return { username: user || undefined }
}

/** GNOME's gvfs: the share is described in the name of a folder under gvfs/. */
export function fromGvfs(path: string): PickedShare | null {
  const parts = path.split('/')
  const at = parts.findIndex((p) => p.startsWith('smb-share:'))
  if (at < 0) return null
  const keys: Record<string, string> = {}
  for (const pair of parts[at].slice('smb-share:'.length).split(',')) {
    const eq = pair.indexOf('=')
    if (eq > 0) keys[pair.slice(0, eq)] = decode(pair.slice(eq + 1))
  }
  if (!keys.server || !keys.share) return null
  return {
    host: keys.server,
    share: keys.share,
    folder: clean(parts.slice(at + 1)).join('/'),
    username: keys.user || undefined,
    domain: keys.domain || undefined
  }
}

/** KDE's kio-fuse: smb/[user@]host/share/folder under a kio-fuse-* folder. */
export function fromKioFuse(path: string): PickedShare | null {
  const parts = path.split('/')
  const at = parts.findIndex((p, i) => p === 'smb' && parts[i - 1]?.startsWith('kio-fuse-'))
  if (at < 0) return null
  const [authority, share, ...rest] = clean(parts.slice(at + 1))
  if (!authority || !share) return null
  const sign = authority.lastIndexOf('@')
  const login = sign > 0 ? splitUser(authority.slice(0, sign)) : {}
  return { host: authority.slice(sign + 1), share, folder: rest.join('/'), ...login }
}

interface Mount {
  /** Where the share is mounted on this machine. */
  at: string
  host: string
  share: string
  /** A folder inside the share that the mount starts at, if it does not start at the root. */
  base: string
  username?: string
  domain?: string
}

/** The mount holding `path`: the deepest one, as a mount inside a mount is the one in use. */
function within(path: string, mounts: Mount[], sep: string, fold = false): PickedShare | null {
  const norm = (p: string): string => (fold ? p.toLowerCase() : p)
  let best: Mount | null = null
  for (const m of mounts) {
    const at = m.at.endsWith(sep) ? m.at.slice(0, -1) : m.at
    const p = norm(path)
    if (p === norm(at) || p.startsWith(norm(at) + sep)) {
      if (!best || at.length > best.at.length) best = { ...m, at }
    }
  }
  if (!best) return null
  const inside = path.slice(best.at.length).split(sep)
  return {
    host: best.host,
    share: best.share,
    folder: clean([...best.base.split('/'), ...inside]).join('/'),
    username: best.username,
    domain: best.domain
  }
}

/** /proc/mounts escapes a space, tab, newline and backslash as octal. */
const unescapeMount = (s: string): string =>
  s.replace(/\\([0-7]{3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)))

/** A cifs or smb3 mount on Linux, from the text of /proc/mounts. */
export function fromLinuxMounts(path: string, mounts: string): PickedShare | null {
  const list: Mount[] = []
  for (const line of mounts.split('\n')) {
    const [source, at, type, options = ''] = line.split(' ')
    if (!source || !at || !/^(cifs|smb3?)$/.test(type ?? '')) continue
    const [host, share, ...base] = clean(unescapeMount(source).split(/[\\/]/))
    if (!host || !share) continue
    const opts = Object.fromEntries(
      options.split(',').map((o) => {
        const eq = o.indexOf('=')
        return eq < 0 ? [o, ''] : [o.slice(0, eq), o.slice(eq + 1)]
      })
    )
    list.push({
      at: unescapeMount(at),
      host,
      share,
      base: base.join('/'),
      username: opts.username || opts.user || undefined,
      domain: opts.domain || undefined
    })
  }
  return within(path, list, '/')
}

/** An smbfs mount on macOS, from the output of `mount`. */
export function fromMacMounts(path: string, mounts: string): PickedShare | null {
  const list: Mount[] = []
  for (const line of mounts.split('\n')) {
    const m = /^\/\/(?:([^@]*)@)?([^/]+)\/(.+?) on (.+) \(smbfs\b/.exec(line)
    if (!m) continue
    const [share, ...base] = clean(m[3].split('/').map(decode))
    if (!share) continue
    list.push({ at: m[4], host: decode(m[2]), share, base: base.join('/'), ...splitUser(m[1] ?? '') })
  }
  return within(path, list, '/')
}

/** A UNC path, or a folder on a mapped drive, from the output of `net use`. */
export function fromWindows(path: string, netUse: string): PickedShare | null {
  const unc = /^[\\/]{2}(?![?.][\\/])([^\\/]+)[\\/]+([^\\/]+)(.*)$/.exec(path)
  if (unc) {
    return { host: unc[1], share: unc[2], folder: clean(unc[3].split(/[\\/]/)).join('/') }
  }
  const list: Mount[] = []
  for (const line of netUse.split(/\r?\n/)) {
    // Columns are localised, the drive letter and the UNC path are not.
    const m = /\b([A-Za-z]:)\s+\\\\([^\\\s]+)\\(\S+)/.exec(line)
    if (!m) continue
    const [share, ...base] = clean(m[3].split(BACKSLASH))
    list.push({ at: m[1], host: m[2], share, base: base.join('/') })
  }
  return within(path, list, BACKSLASH, true)
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

/** The share a picked folder is on, or null when it is on this computer. */
export async function shareForFolder(
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<PickedShare | null> {
  if (platform === 'win32') {
    return fromWindows(path, /^[A-Za-z]:/.test(path) ? await run('net', ['use']) : '')
  }
  if (platform === 'darwin') return fromMacMounts(path, await run('/sbin/mount', []))
  return (
    fromGvfs(path) ??
    fromKioFuse(path) ??
    fromLinuxMounts(path, await readFile('/proc/mounts', 'utf8').catch(() => ''))
  )
}
