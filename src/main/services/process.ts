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
