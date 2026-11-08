import type { TranslateFn } from '../i18n'

/** A failed request on the way to the engine's download, rather than anything about this computer. */
const NO_CONNECTION = /\bHTTP \d{3}\b|net::ERR_|ETIMEDOUT|ENOTFOUND|ECONN|EAI_AGAIN|socket|timed? ?out/i

/**
 * Why the download engine could not be set up or updated, for people.
 *
 * `ytdlp.ts` has its own words for this, in English, and they matter: an engine
 * that was installed and will not start is antivirus nine times out of ten, and
 * "check your internet" could never help with it. The original text stays in the
 * log, and on hover where the screen has room for that.
 */
export function engineFailureText(t: TranslateFn, message: string | undefined, doing: 'setup' | 'update'): string {
  const raw = message ?? ''
  if (/failed to start/i.test(raw)) return t('engine.startFailed')
  if (/no download engine is published/i.test(raw)) return t('engine.noBuild')
  if (/waiting after a failed attempt/i.test(raw)) return t('engine.updateWaiting')
  if (doing === 'setup') return t('engine.setupFailed')
  return NO_CONNECTION.test(raw) ? t('engine.updateNoConnection') : t('settings.engineFailed')
}
