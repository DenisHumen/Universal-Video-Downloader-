import type { TranslateFn } from '../i18n'

/** The server, or the way to it, rather than anything about this install. */
const NOT_ANSWERING =
  /(^|\D)(429|50[0-4])(\D|$)|gateway|timed? ?out|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|ERR_(INTERNET|NETWORK|NAME|CONNECTION|TIMED|ADDRESS|PROXY)/i

const MAX_CHARS = 160

/**
 * A failed update check or download, for people.
 *
 * electron-updater's message is its whole HTTP exchange - the request, the
 * error page's HTML, every response header - and Settings printed it as is, in
 * a block taller than the row's button. The log keeps all of that; here a
 * server that is not answering says so in the interface language, and anything
 * else is cut to its first line.
 */
export function updateErrorText(t: TranslateFn, message: string | undefined): string {
  const raw = message?.trim()
  if (!raw) return t('update.failed')
  if (NOT_ANSWERING.test(raw)) return t('update.notAnswering')
  const first = raw.split(/\r?\n/)[0].trim()
  return first.length > MAX_CHARS ? `${first.slice(0, MAX_CHARS)}…` : first
}
