import type { AppErrorCode } from './types'

/** What the window is told about the engine it could update. */
export interface EngineFreshness {
  current?: string
  latest?: string
  older: boolean
}

/**
 * Whether `current` is an older release than `latest`.
 *
 * Releases are dates, `2026.03.17`, sometimes with a build after them,
 * `2026.03.17.232`. Compared part by part as numbers, so `.9` is not newer than
 * `.10`, and only when both are in that form: a version this cannot read is not
 * a reason to replace a working engine.
 */
export function engineIsOlder(current: string | undefined, latest: string | undefined): boolean {
  const form = /^\d+(?:\.\d+)+$/
  if (!current || !latest || !form.test(current) || !form.test(latest)) return false
  const a = current.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff < 0
  }
  return false
}

/** Codes that say the site is not what the engine expected, which is what a newer engine is for. */
const SITE_CHANGED: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(['noFormats', 'playerChanged'])

/*
  What the engine prints when its own code tripped over a page, in a failure the
  app has no code for: its plea for a bug report, a Python traceback, or a named
  extractor giving up. "Unable to extract" has a code of its own already, but the
  wording arrives on its own in a report's raw text as well.
*/
const STACK = /Traceback \(most recent call last\)|please report this issue|Confirm you are on the latest version|ExtractorError|\b(?:KeyError|TypeError|IndexError|AttributeError|ValueError): |Unable to extract/i

/** Whether a failure looks like the site having moved under the engine, and not the network, the person or the video. */
export function siteMayHaveChanged(code: AppErrorCode | undefined, said?: string): boolean {
  if (code) return SITE_CHANGED.has(code)
  return Boolean(said && STACK.test(said))
}
