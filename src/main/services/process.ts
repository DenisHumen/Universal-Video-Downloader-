import { execFile, type ChildProcess } from 'child_process'

/**
 * Spawn options that make a child killable as a group.
 *
 * On POSIX, `detached` makes the child a process-group leader, which is the
 * only way to signal it *and* everything it started. Windows has no process
 * groups to speak of; `taskkill /T` walks the tree there instead.
 *
 * The child is never `unref`'d — the app still owns it and still kills it on
 * shutdown. `detached` here is about who receives the signal, not about
 * outliving the parent.
 */
export function groupSpawnOptions(): { detached?: boolean } {
  return process.platform === 'win32' ? {} : { detached: true }
}

/*
  Windows has no signal to send a console program, only a console event, and a
  process can only send that to the console it is attached to. So a short-lived
  PowerShell leaves its own console, joins the child's, ignores the event itself
  and fires it at everyone there, which is the engine and its ffmpeg - exactly
  what pressing Ctrl-C in that window would do. `taskkill` without /F cannot do
  this: it posts a close message, and these have no window to receive one.
*/
export function ctrlCScript(pid: number): string {
  return [
    `Add-Type -Namespace Uvd -Name Con -MemberDefinition '` +
      `[DllImport("kernel32.dll")] public static extern bool FreeConsole();` +
      `[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id);` +
      `[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool add);` +
      `[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);'`,
    '[Uvd.Con]::FreeConsole() | Out-Null',
    `if (-not [Uvd.Con]::AttachConsole(${Math.trunc(pid)})) { exit 2 }`,
    '[Uvd.Con]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null',
    'if (-not [Uvd.Con]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }',
    'exit 0'
  ].join('; ')
}

/**
 * Ask a child and everything it started to finish up, as Ctrl-C does.
 *
 * ffmpeg writes out what it has and closes its file, and the engine treats the
 * end of a live capture as a normal end: it fixes the container and exits 0.
 * `onFailed` is for when the request could not even be delivered. A delivered
 * one can still be ignored, so the caller keeps its own deadline as well.
 */
export function interruptTree(child: ChildProcess, onFailed: () => void): void {
  if (child.pid == null) {
    onFailed()
    return
  }
  if (process.platform === 'win32') {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ctrlCScript(child.pid)],
      { windowsHide: true, timeout: 10_000 },
      (err) => {
        if (err) onFailed()
      }
    )
    return
  }
  try {
    // ffmpeg gets it directly as well, as it would from a terminal - see groupSpawnOptions.
    process.kill(-child.pid, 'SIGINT')
  } catch {
    try {
      child.kill('SIGINT')
    } catch {
      onFailed()
    }
  }
}

/**
 * Terminate a child and everything it started.
 *
 * `child.kill()` signals one process. yt-dlp is not one process: it launches
 * ffmpeg to merge video with audio and to extract audio tracks, which is the
 * longest phase of a large download. Killing only the parent left ffmpeg
 * running — still writing the output file, still using the CPU — after the app
 * had already reported the download as cancelled, and after the partial-file
 * cleanup had tried to delete the very files it was writing.
 *
 * Best-effort by design: a process that has already exited, or that we are not
 * allowed to signal, is not an error worth surfacing. The caller has already
 * moved the item to its new state.
 */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child || child.pid == null) return

  if (process.platform === 'win32') {
    // /T takes the children with it, /F because ffmpeg ignores a polite ask
    // while it holds a write handle open.
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined)
    return
  }

  try {
    // Negative pid targets the whole group — see groupSpawnOptions.
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Not a group leader (spawned without `detached`), or already gone.
    try {
      child.kill('SIGTERM')
    } catch {
      /* already exited */
    }
  }
}
