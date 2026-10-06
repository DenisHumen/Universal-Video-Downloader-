import { translate, useI18n, type Language, type TranslationKey } from '../i18n'

/*
  Sizes, speeds, times left and view counts are read in the interface's
  language, like every other word on the row. They used to be English
  whatever the setting: a Russian queue said "осталось 1m 35s", where "m"
  reads as metres, and wrote "1.5 MB" with a point where Russian writes a
  comma.

  Each helper takes the language as its last argument and, left out, uses the
  active one — the same non-reactive read t() makes. Every component that
  shows these figures already subscribes to the language through useT, so it
  renders again when the language changes and the read is current.
*/
const activeLanguage = (): Language => useI18n.getState().language

const BYTE_UNITS: TranslationKey[] = ['bytes.B', 'bytes.KB', 'bytes.MB', 'bytes.GB', 'bytes.TB']

// Building a formatter is far dearer than using one, and a busy queue formats
// a few figures per row on every progress tick.
const decimals = new Map<string, Intl.NumberFormat>()

/** `value` with exactly `digits` decimals, separated the way `language` writes them. */
function decimal(value: number, digits: number, language: Language): string {
  const id = `${language}:${digits}`
  let format = decimals.get(id)
  if (!format) {
    // No grouping: the next unit takes over at 1024, so grouping could only
    // ever split 1000–1023, and "1,023 KB" reads as a fraction in half the
    // world.
    format = new Intl.NumberFormat(language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false
    })
    decimals.set(id, format)
  }
  return format.format(value)
}

export function formatBytes(bytes?: number, language: Language = activeLanguage()): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  let value = bytes
  let i = 0
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024
    i++
  }
  // One decimal below ten, always shown — "5.0 MB", not "5 MB" — so a running
  // download's figure keeps its width instead of twitching each time it
  // crosses a whole number.
  return `${decimal(value, value >= 10 || i === 0 ? 0 : 1, language)} ${translate(language, BYTE_UNITS[i])}`
}

export function formatSpeed(bytesPerSecond?: number, language: Language = activeLanguage()): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  return `${formatBytes(bytesPerSecond, language)}${translate(language, 'speed.perSecond')}`
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

/**
 * How long is left, as a bare duration in the interface's language: `1m 35s`,
 * `1 мин 35 с`.
 *
 * The word "left" is not in here on purpose: the sentence around the duration
 * is the caller's (`queue.eta`), and so is its word order. The units used to
 * be English symbols on the assumption that they read the same everywhere,
 * which they don't — "m" is metres to a Russian reader.
 *
 * The total is rounded before it is split, so 119.7 seconds is `2m 0s`, not
 * `1m 60s`.
 */
export function formatEta(seconds?: number, language: Language = activeLanguage()): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  if (total < 60) return translate(language, 'time.eta.s', { s: total })
  const m = Math.floor(total / 60)
  if (m < 60) return translate(language, 'time.eta.m', { m, s: total % 60 })
  return translate(language, 'time.eta.h', { h: Math.floor(m / 60), m: m % 60 })
}

const compacts = new Map<Language, Intl.NumberFormat>()

/** A view count the way the language abbreviates it: `1.2M`, `1,2 млн`. */
export function formatCount(n?: number, language: Language = activeLanguage()): string {
  if (n == null) return ''
  let format = compacts.get(language)
  if (!format) {
    format = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 })
    compacts.set(language, format)
  }
  return format.format(n)
}

/**
 * A saved file's path as folder and file name, so a row can shorten the
 * folder and keep the name.
 *
 * One truncated line used to cut from the end, and a long title plus
 * ` [id].mp4` pushed the file name — the part anyone is looking for — off the
 * row, leaving `…\youtube\Some Extremely Long Video Title…`. Either separator
 * counts, because the renderer has no `node:path` and the same queue shows
 * Windows paths and POSIX ones. The folder keeps its trailing separator, so the
 * two halves put back together are exactly the path.
 */
export function splitPath(path: string): { dir: string; base: string } {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: path.slice(0, i + 1), base: path.slice(i + 1) }
}

export function isProbablyUrl(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /^(https?:\/\/|www\.)\S+\.\S+/i.test(t) || /^[\w-]+\.\w{2,}\/\S+/i.test(t)
}
