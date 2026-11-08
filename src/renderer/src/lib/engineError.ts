import type { TranslateFn } from '../i18n/translate'

/** A failed request on the way to the engine's download, rather than anything about this computer. */
const NO_CONNECTION = /\bHTTP \d{3}\b|net::ERR_|ETIMEDOUT|ENOTFOUND|ECONN|EAI_AGAIN|socket|timed? ?out/i

/** An engine that is there and will not start: antivirus, and no connection could fix that. */
const FAILED_TO_START = /failed to start/i
const NO_BUILD = /no download engine is published/i

/**
 * The sentence for a detect or a search that found no engine to run.
 *
 * It says to check the connection, which is the usual reason on a first run and
 * no help at all for the two that are not about the connection.
 */
export function engineMissingText(t: TranslateFn, message: string | undefined): string {
  const raw = message ?? ''
  if (FAILED_TO_START.test(raw)) return t('engine.startFailed')
  if (NO_BUILD.test(raw)) return t('engine.noBuild')
  return t('err.engineMissing')
}

/** Whether a proxy could be behind this: the engine could not be fetched, rather than run or found for this system. */
export function proxyMayBeWhy(message: string | undefined, proxy: string | undefined): boolean {
  const raw = message ?? ''
  return Boolean(proxy?.trim()) && !FAILED_TO_START.test(raw) && !NO_BUILD.test(raw)
}

/**
 * Why the download engine could not be set up or updated, for people.
 *
 * `ytdlp.ts` has its own words for this, in English, and they matter: an engine
 * that was installed and will not start is antivirus nine times out of ten, and
 * "check your internet" could never help with it. The original text stays in the
 * log, and on hover where the screen has room for that.
 */
export function engineFailureText(
  t: TranslateFn,
  message: string | undefined,
  doing: 'setup' | 'update',
  proxy?: string
): string {
  const raw = message ?? ''
  if (FAILED_TO_START.test(raw)) return t('engine.startFailed')
  if (NO_BUILD.test(raw)) return t('engine.noBuild')
  if (/waiting after a failed attempt/i.test(raw)) return t('engine.updateWaiting')
  if (proxyMayBeWhy(raw, proxy)) return t('engine.proxyFailed')
  if (doing === 'setup') return t('engine.setupFailed')
  return NO_CONNECTION.test(raw) ? t('engine.updateNoConnection') : t('settings.engineFailed')
}
