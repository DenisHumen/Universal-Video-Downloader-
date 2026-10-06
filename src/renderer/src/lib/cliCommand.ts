import type { CliStatus } from '@shared/types'
import type { TranslateFn } from '../i18n'

export interface CliRow {
  hint: string
  /** The row offers to install the command. */
  install: boolean
  /** ...but cannot yet: the app is running from somewhere a link would not outlive. */
  disabled: boolean
}

/** The folder a command path is in, as the PATH would list it. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at > 0 ? path.slice(0, at) : path
}

/**
 * What Settings says about the terminal command, and whether it offers a button.
 *
 * Null hides the row: on Windows there is no command to install, and before
 * main has answered there is nothing true to say yet. A Linux package installs
 * the command itself, so its row only reports. An AppImage's folder may well
 * not be on the PATH the first time anything is put in it, and a command the
 * terminal cannot find looks exactly like one that was never installed - so
 * that is said both before installing and after.
 */
export function describeCliCommand(status: CliStatus | null, t: TranslateFn): CliRow | null {
  if (!status || status.method === 'none') return null
  const path = status.path ?? ''
  const report = (hint: string): CliRow => ({ hint, install: false, disabled: false })

  if (status.method === 'development') return report(t('settings.cliDevelopment'))
  if (status.method === 'package') {
    return report(status.installed ? t('settings.cliPackage', { path }) : t('settings.cliPackageMissing', { path }))
  }

  const dir = folderOf(path)
  const pathAdvice = status.method === 'script' && status.onPath === false ? ` ${t('settings.cliNotOnPath', { dir })}` : ''
  if (status.installed) return report(t('settings.cliInstalled', { path }) + pathAdvice)
  if (status.temporary) return { hint: t('settings.cliTemporary'), install: true, disabled: true }
  const hint = status.occupied ? t('settings.cliOccupied', { path }) : t('settings.cliMissing', { dir })
  return { hint: hint + pathAdvice, install: true, disabled: false }
}
