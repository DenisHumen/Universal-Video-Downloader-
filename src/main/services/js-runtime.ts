import { accessSync, constants, statSync } from 'fs'
import { delimiter, isAbsolute, join } from 'path'
import { type MigrationFailure } from './engine-dist'

/*
  The JavaScript runtime the engine answers YouTube's challenges with.

  Since yt-dlp 2025.11 YouTube without a runtime falls back to a single client
  and "some formats may be missing"; the solver scripts are inside every build
  the app installs (yt_dlp_ejs in the onedir and single-file builds), the runtime
  is not. Why this one, measured with the engine's own solver on YouTube's real
  player (2.6 MB) on Windows x64:

    Deno 2.9.8        0.7 s    nothing allowed: file, env, network, process and
                               ffi all refused under the flags the engine gives it
    QuickJS-NG 0.18   4.1 s    no sandbox: `import('qjs:std')` read a file and the
                               environment from inside `qjs --script`
    Node 26           0.5 s    `--permission` leaves the environment readable, which
                               is where the proxy password is, and only Node 25+
                               closes the network; the engine accepts Node from 22

  What it runs is remote code, so the sandbox decides it. Bundling was the other
  choice: every installer would grow by about 40 MB for a file that changes on its
  own schedule. Fetched once instead, like the engine, into the same private folder.
*/

export const DENO_VERSION = '2.9.8'

export interface DenoPin {
  /** The release asset; each holds one file, the `deno` program. */
  asset: string
  sha256: string
}

/**
 * Each archive by name *and* SHA-256, checked against the release's own
 * `.sha256sum` files when pinned. Bump all six together, with DENO_VERSION. `deno`, not `denort`, which cannot run a
 * script from stdin. Windows on 32 bits and 32-bit ARM Linux have no build.
 */
export const DENO_PINS: Record<string, DenoPin> = {
  'win32-x64': {
    asset: 'deno-x86_64-pc-windows-msvc.zip',
    sha256: 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf'
  },
  'win32-arm64': {
    asset: 'deno-aarch64-pc-windows-msvc.zip',
    sha256: 'b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef'
  },
  'darwin-x64': {
    asset: 'deno-x86_64-apple-darwin.zip',
    sha256: '4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c'
  },
  'darwin-arm64': {
    asset: 'deno-aarch64-apple-darwin.zip',
    sha256: '9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e'
  },
  'linux-x64': {
    asset: 'deno-x86_64-unknown-linux-gnu.zip',
    sha256: 'e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609'
  },
  'linux-arm64': {
    asset: 'deno-aarch64-unknown-linux-gnu.zip',
    sha256: 'd49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905'
  }
}

export function denoPin(platform: string, arch: string): DenoPin | undefined {
  return DENO_PINS[`${platform}-${arch}`]
}

export function denoUrl(pin: DenoPin): string {
  return `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${pin.asset}`
}

export function denoExeName(platform: string = process.platform): string {
  return platform === 'win32' ? 'deno.exe' : 'deno'
}

/** A folder per pin, so bumping one leaves the old copy working until the new one has started. */
export function denoDirName(pin: DenoPin): string {
  return `deno-${DENO_VERSION}-${pin.sha256.slice(0, 12)}`
}

/** What `deno --version` must open with: another version in that folder is not the pinned file. */
export function isPinnedBanner(stdout: string): boolean {
  return stdout.startsWith(`deno ${DENO_VERSION} `)
}

/** Earlier pins, and what a crash cut short. The cache and the failure note stay. */
export function staleRuntimeEntries(names: string[], keep: string): string[] {
  return names.filter(
    (name) => name !== keep && (name.startsWith('deno-') || name.startsWith('.unpack-') || name.endsWith('.download'))
  )
}

const RETRY_MS = 15 * 60_000
const RETRY_MAX_MS = 7 * 24 * 3_600_000

/**
 * Whether the last failed fetch is still too recent to try another.
 *
 * Soon at first, since most failures are the network and YouTube stays limited
 * meanwhile, and rarely once it has plainly stopped working: each try is 40 MB,
 * and a build that will not start on this machine fails the same way every time.
 */
export function runtimeFetchBlocked(failure: MigrationFailure | undefined, now: number): boolean {
  if (!failure) return false
  const wait = Math.min(RETRY_MAX_MS, RETRY_MS * 4 ** Math.max(0, failure.count - 1))
  return now - failure.at < wait
}

/**
 * A Deno the person already has, by absolute path, from PATH proper.
 *
 * Left to itself the engine looks for one on Windows in the folder it was started
 * from before it looks on PATH, and runs what it finds: checked on the real engine,
 * a deno.exe in that folder was run, and for `uvd` that folder is wherever the
 * terminal happens to be. Nothing is run here; the engine asks it for its version
 * and passes over one too old.
 */
export function denoOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform
): string | null {
  const name = denoExeName(platform)
  const path = env.PATH ?? env.Path ?? ''
  const separator = platform === 'win32' ? ';' : delimiter
  for (const dir of path.split(separator)) {
    // An empty or relative entry means the current folder, which is the same hole.
    if (!dir || !isAbsolute(dir)) continue
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* not here */
    }
  }
  return null
}

/**
 * The engine's arguments for a runtime, or for none.
 *
 * None is said outright, for the reason above. There is deliberately no
 * `--remote-components`: the solver comes from the installed engine, never from
 * npm or GitHub at run time. Node, QuickJS and Bun are not enabled, see the top.
 */
export function jsRuntimeArgs(exe: string | null): string[] {
  return exe ? ['--js-runtimes', `deno:${exe}`] : ['--no-js-runtimes']
}

/** A link the runtime matters for. Nothing else the engine reads uses one yet. */
export function isYoutubeLink(url: string): boolean {
  try {
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

let chosen: string | null = null
let installing: Promise<unknown> | null = null

/** Which runtime the engine gets from here on. */
export function useJsRuntime(exe: string | null): void {
  chosen = exe
}

/**
 * An engine command line with the runtime in it. Every spawn goes through this,
 * ahead of its arguments, so it can never land behind their `--`.
 */
export function withJsRuntime(args: string[]): string[] {
  return [...jsRuntimeArgs(chosen), ...args]
}

/** The fetch under way, for whoever would rather wait for it; see `jsRuntimeSettled`. */
export function trackRuntimeInstall(work: Promise<unknown>): void {
  installing = work
  const clear = (): void => {
    if (installing === work) installing = null
  }
  work.then(clear, clear)
}

/**
 * Wait for a fetch that is under way, up to a limit, and never fail.
 *
 * Only for a YouTube link in the first moments after install, whose answer would
 * otherwise be the limited one. Nothing else waits: a slow or failed fetch must
 * not hold up a download.
 */
export function jsRuntimeSettled(limitMs: number, signal?: AbortSignal): Promise<void> {
  const work = installing
  if (!work || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, limitMs)
    signal?.addEventListener('abort', finish, { once: true })
    work.then(finish, finish)
  })
}
