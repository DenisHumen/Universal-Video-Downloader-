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
  emptyPage: 'err.emptyPage'
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
