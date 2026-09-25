import type { AppErrorCode } from '@shared/types'
import type { TranslateFn, TranslationKey } from '../i18n'

/**
 * Say what went wrong in the user's language.
 *
 * The main process talks to yt-dlp and ffmpeg, both of which only speak
 * English, and for a long time so did every failure the app reported: the
 * interface was fully translated right up to the moment something broke —
 * which is exactly the moment the wording matters. The main process now sends
 * a code alongside its English sentence, and this turns that code into a
 * translated line. Anything it doesn't recognise falls back to the sentence,
 * which is still better than nothing at all.
 */
const KEYS: Record<AppErrorCode, TranslationKey> = {
  unavailable: 'err.unavailable',
  ageRestricted: 'err.ageRestricted',
  rateLimited: 'err.rateLimited',
  signIn: 'err.signIn',
  forbidden: 'err.forbidden',
  geo: 'err.geo',
  drm: 'err.drm',
  diskFull: 'err.diskFull',
  permission: 'err.permission',
  postprocess: 'err.postprocess',
  noFormats: 'err.noFormats',
  network: 'err.network',
  timeout: 'err.timeout',
  canceled: 'err.canceled',
  sourceMissing: 'err.sourceMissing',
  noAudioTrack: 'err.noAudioTrack',
  damagedSource: 'err.damagedSource',
  unknownEncoder: 'err.unknownEncoder',
  ffmpegMissing: 'err.ffmpegMissing',
  streamGone: 'err.streamGone',
  corruptLink: 'err.corruptLink',
  emptyPage: 'err.emptyPage',
  cutFailed: 'err.cutFailed'
}

export interface FailureLike {
  error?: string
  errorCode?: AppErrorCode
  cookieHint?: boolean
}

/** The sentence to show for a failure, translated when the code is known. */
export function errorText(t: TranslateFn, failure: FailureLike): string {
  const key = failure.errorCode ? KEYS[failure.errorCode] : undefined
  const base = key ? t(key) : failure.error?.trim()
  if (!base) return t('error.title')
  return failure.cookieHint ? `${base} ${t('err.cookieHint')}` : base
}

/**
 * What to show when something *threw*, rather than reported a code.
 *
 * An error that crosses the IPC bridge arrives wearing Electron's wrapper -
 * `Error invoking remote method 'auto:test-smb': SmbError: There is no share
 * by that name on the server.` - and the careful sentence written in main is
 * buried behind a channel name and a class name that mean nothing to anyone
 * reading a toast. This takes the machinery off and leaves the sentence; the
 * message itself is kept verbatim, so whatever main went to the trouble of
 * saying still reaches the screen.
 */
export function describeError(err: unknown): string {
  let text = (err instanceof Error ? err.message : String(err ?? '')).trim()

  // Electron: "Error invoking remote method '<channel>': <the actual error>"
  const wrapped = text.match(/^Error invoking remote method '[^']*':\s*(.*)$/s)
  if (wrapped) text = wrapped[1].trim()

  // A thrown class announcing itself: "SmbError: ...", "TypeError: ...".
  const classed = text.match(/^[A-Z][A-Za-z0-9]*Error:\s+(.*)$/s)
  if (classed) text = classed[1].trim()

  return text || 'Something went wrong.'
}
