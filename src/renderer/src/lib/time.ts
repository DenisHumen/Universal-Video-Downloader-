/** Parsing and printing of the `H:MM:SS` timestamps the trim editor uses. */

/** Seconds → `M:SS` or `H:MM:SS`, matching how players label positions. */
export function toClock(seconds: number, forceHours = false): string {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (h > 0 || forceHours) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

/**
 * Parse what a person actually types: `90`, `1:30`, `01:02:03`, `1:30.5`.
 * Returns undefined for anything it can't make sense of, so the caller can
 * leave the previous value alone rather than jumping to zero.
 */
export function parseClock(input: string): number | undefined {
  const text = input.trim().replace(',', '.')
  if (!text) return undefined
  if (!/^[\d:.]+$/.test(text)) return undefined

  const parts = text.split(':')
  if (parts.length > 3) return undefined

  let total = 0
  for (const part of parts) {
    const value = Number(part)
    if (!Number.isFinite(value) || value < 0) return undefined
    total = total * 60 + value
  }
  return Number.isFinite(total) ? total : undefined
}

/** Clamp to `[0, max]`, rounded to a tenth of a second. */
export function clampTime(value: number, max?: number): number {
  const upper = max != null && max > 0 ? max : Number.MAX_SAFE_INTEGER
  return Math.round(Math.min(Math.max(0, value), upper) * 10) / 10
}
