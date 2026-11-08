import { t } from '../i18n'
import { toast } from './toast'

/** Show a file in its folder, or say that it is no longer there. */
export async function showFile(path: string): Promise<void> {
  if (!(await window.api.showInFolder(path))) toast(t('queue.showFailed'), 'error')
}
