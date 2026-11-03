import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { WINDOW_BACKGROUND, paintedTheme, themeArgument, themeFromArgv } from './theme-boot'

const css = readFileSync(join(__dirname, '../renderer/src/index.css'), 'utf-8')

/** `--bg` inside the first block whose selector list contains `selector`. */
function bgOf(selector: string): string {
  const block = css
    .split('}')
    .find((b) => b.slice(0, b.indexOf('{')).includes(selector) && /--bg:/.test(b))
  const m = block?.match(/--bg:\s*(\d+)\s+(\d+)\s+(\d+)/)
  if (!m) throw new Error(`no --bg for ${selector}`)
  return (
    '#' +
    m
      .slice(1, 4)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
  )
}

describe('theme boot', () => {
  it('round-trips the theme through argv', () => {
    expect(themeFromArgv(['electron', themeArgument('day')])).toBe('day')
    expect(themeFromArgv(['electron', themeArgument('night')])).toBe('night')
  })

  it('ignores a missing or unknown value', () => {
    expect(themeFromArgv(undefined)).toBeNull()
    expect(themeFromArgv(['--uvd-theme=neon'])).toBeNull()
  })

  it('resolves a stored setting against the OS preference', () => {
    expect(paintedTheme('day', true)).toBe('day')
    expect(paintedTheme('night', false)).toBe('night')
    expect(paintedTheme('system', true)).toBe('night')
    expect(paintedTheme('system', false)).toBe('day')
  })

  it('paints the native window in the stylesheet canvas colour', () => {
    expect(WINDOW_BACKGROUND.night).toBe(bgOf("[data-theme='night']"))
    expect(WINDOW_BACKGROUND.day).toBe(bgOf("[data-theme='day']"))
  })
})
