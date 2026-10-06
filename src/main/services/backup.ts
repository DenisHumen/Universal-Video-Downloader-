import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  backupFileName,
  buildBackup,
  parseBackup,
  planImport,
  type ExportOutcome,
  type ImportOutcome
} from '@shared/backup'
import type { AppSettings } from '@shared/types'
import { addWatch, listWatches } from './automation/store'
import { getSettings } from './settings'
import { log } from './log'

/**
 * The disk and dialog half of a backup. What goes into the file, what a file
 * must look like and how it is merged are all decided in `@shared/backup`,
 * where they are tested; this only asks where, reads, writes and applies.
 */

const FILTERS = [{ name: 'JSON', extensions: ['json'] }]

/**
 * Far beyond any real backup - a hundred watches with a long history each is
 * well under a megabyte - and small enough that picking a video file by
 * mistake is refused before the whole of it is read into memory.
 */
const MAX_BYTES = 16 * 1024 * 1024

/** The kind of failure and nothing of the path, which can carry a user name. */
function failure(err: unknown): Record<string, string | undefined> {
  if (!(err instanceof Error)) return { error: typeof err }
  return { error: err.name, code: (err as NodeJS.ErrnoException).code }
}

export async function exportBackup(win: BrowserWindow | undefined): Promise<ExportOutcome> {
  const now = new Date()
  const options: SaveDialogOptions = {
    defaultPath: join(app.getPath('documents'), backupFileName(now)),
    filters: FILTERS
  }
  const choice = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (choice.canceled || !choice.filePath) return { ok: false, canceled: true }

  // Read after the dialog, so a setting changed while it was open is in the file.
  const backup = buildBackup({
    settings: getSettings(),
    watches: listWatches(),
    app: app.getVersion(),
    now
  })
  try {
    writeFileSync(choice.filePath, JSON.stringify(backup, null, 2), 'utf-8')
  } catch (err) {
    log.error('backup', 'Could not write the backup', failure(err))
    return { ok: false, error: 'write' }
  }
  log.info('backup', 'Exported a backup', {
    watches: backup.watches.length,
    targets: backup.smbTargets.length
  })
  return {
    ok: true,
    path: choice.filePath,
    watches: backup.watches.length,
    targets: backup.smbTargets.length
  }
}

/**
 * Ask for a backup, check it, and merge it in.
 *
 * `apply` is the settings' own update path, handed in by the IPC layer so an
 * import does exactly what a change on the settings screen does: the same
 * migration repairs and clamps every value, a proxy password still goes to
 * the secret store, and the tray, the watcher and the queue hear about it.
 */
export async function importBackup(
  win: BrowserWindow | undefined,
  apply: (partial: Partial<AppSettings>) => AppSettings
): Promise<ImportOutcome> {
  const options: OpenDialogOptions = {
    properties: ['openFile'],
    filters: [...FILTERS, { name: 'All files', extensions: ['*'] }]
  }
  const choice = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (choice.canceled || !choice.filePaths.length) return { ok: false, canceled: true }

  let source: string
  try {
    const file = choice.filePaths[0]
    if (statSync(file).size > MAX_BYTES) return { ok: false, error: 'format' }
    source = readFileSync(file, 'utf-8')
  } catch (err) {
    log.warn('backup', 'Could not read the chosen backup', failure(err))
    return { ok: false, error: 'read' }
  }

  const parsed = parseBackup(source)
  if (!parsed.ok) {
    log.warn('backup', 'Refused a file offered as a backup', { why: parsed.error })
    return parsed
  }

  const plan = planImport(
    parsed,
    { settings: getSettings(), watches: listWatches() },
    { now: Date.now(), newId: () => randomUUID(), exists: existsSync }
  )
  const settings = Object.keys(plan.settings).length ? apply(plan.settings) : getSettings()
  for (const watch of plan.watches) addWatch(watch)

  log.info('backup', 'Imported a backup', {
    from: parsed.backup.app.slice(0, 32) || undefined,
    settings: plan.counts.settings ? 'applied' : 'unchanged',
    watchesAdded: plan.counts.watchesAdded,
    watchesSkipped: plan.counts.watchesSkipped,
    watchesInvalid: plan.counts.watchesInvalid,
    targetsAdded: plan.counts.targetsAdded
  })
  return { ok: true, counts: plan.counts, settings }
}
