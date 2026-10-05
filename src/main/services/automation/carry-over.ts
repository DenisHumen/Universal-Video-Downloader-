import type { Run, StepKind } from '@shared/automation'

/**
 * What an earlier go at an episode got done that the next go need not repeat.
 *
 * Apart from the pipeline so it can be tested without the queue or a disk.
 * Getting it wrong is expensive in one direction only: a retry that does not
 * notice the file it already has downloads the whole episode again and leaves
 * a second copy beside the first, every check, for every upload a sleeping NAS
 * refused.
 */
export interface CarryOver {
  /** The file it downloaded (and renamed, if it got that far), still on disk. */
  filepath?: string
  /** Where it put that file, when the upload went through and only a later step failed. */
  remotePath?: string
}

/**
 * Pick up where `previous` left off.
 *
 * Only from a run that ended without finishing; a run that is done has nothing
 * to pick up, and one still running is not ours to take. The download counts
 * only while its file is still where the run left it - somebody may have moved
 * or deleted it since, and then the episode is fetched again. An upload that
 * went through counts whatever became of the local file, which the upload step
 * may itself have removed.
 */
export function carryOver(previous: Run | undefined, exists: (path: string) => boolean): CarryOver {
  if (!previous || (previous.state !== 'failed' && previous.state !== 'skipped')) return {}
  const done = (kind: StepKind): boolean =>
    previous.steps.some((s) => s.kind === kind && s.state === 'done')

  const filepath =
    previous.filepath && done('download') && exists(previous.filepath) ? previous.filepath : undefined
  if (previous.remotePath && done('upload')) return { filepath, remotePath: previous.remotePath }
  return filepath ? { filepath } : {}
}
