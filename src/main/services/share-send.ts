import { basename } from 'path'
import type { SmbTarget } from '@shared/automation'
import type { ShareSendRequest, ShareSendResult } from '@shared/types'
import { SmbError, uploadFile } from './automation/smb'
import { SECRET, getSecretWhenReady } from './secrets'

/**
 * Send one finished file to a configured share, because somebody asked.
 *
 * The upload itself is the one a watch uses. What differs is who has the last
 * word on a name already taken: a watch's re-run replaces its own episode, and a
 * person gets asked, so this starts with `replace` off and only ever turns it on
 * for a request that says so. The password is the stored one and stays on this
 * side of the bridge.
 *
 * The folder is share-relative as the folder dialog gives it, the target's own
 * folder included, so the target goes in without one.
 */
export async function sendToShare(
  request: ShareSendRequest,
  file: string,
  targets: readonly SmbTarget[],
  onProgress?: (bytes: number, total: number) => void
): Promise<ShareSendResult> {
  const target = targets.find((candidate) => candidate.id === request.targetId)
  if (!target) return { status: 'failed', kind: 'noTarget', message: 'That share is no longer set up.' }
  const password = await getSecretWhenReady(SECRET.smbPassword(target.id))
  if (!password) {
    return { status: 'failed', kind: 'noPassword', message: `No password is stored for "${target.name}".` }
  }
  try {
    const { remotePath } = await uploadFile(
      { ...target, path: '' },
      password,
      file,
      request.folder,
      basename(file),
      onProgress,
      request.replace === true
    )
    return { status: 'sent', remotePath }
  } catch (err) {
    if (err instanceof SmbError) {
      if (err.kind === 'exists') return { status: 'exists', name: basename(file) }
      return { status: 'failed', kind: err.kind, message: err.message }
    }
    return { status: 'failed', kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
  }
}
