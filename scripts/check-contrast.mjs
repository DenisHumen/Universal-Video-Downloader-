/**
 * WCAG contrast gate for the theme palettes.
 *
 * Text colours in this app are alphas over a `--fg` token, and the same alpha
 * reads very differently depending on the surface behind it — white at 50% over
 * a near-black card is comfortably readable, near-black at 50% over a white
 * card is not. That asymmetry is easy to reintroduce by "just tweaking a
 * colour", and a browser spot-check only ever covers the theme you happen to be
 * looking at.
 *
 * This reads the real values out of `index.css` (so it can't drift from the
 * stylesheet), works out what every dim text tier actually renders as on every
 * surface of every theme, and fails if anything lands under 4.5:1.
 *
 * Run: node scripts/check-contrast.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/src/index.css'), 'utf-8')

const AA_NORMAL = 4.5
/** Tiers used for body/label text. Decorative icon tints are out of scope. */
const TEXT_TIERS = [0.5, 0.55, 0.6, 0.7]
/** Surfaces text actually sits on, darkest-contrast-first. */
const SURFACE_VARS = ['--ink-800', '--ink-850', '--ink-900', '--ink-950']

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

/** Pull `--name: r g b` out of a theme block. */
function readTheme(selector) {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 's'))
  if (!block) return null
  const vars = {}
  for (const m of block[1].matchAll(/(--[\w-]+):\s*([\d]+\s+[\d]+\s+[\d]+)\s*;/g)) {
    vars[m[1]] = m[2].split(/\s+/).map(Number)
  }
  return vars
}

/** Light-mode overrides remap some tiers to a higher alpha. */
function readOverrides(theme) {
  const map = new Map()
  const re = new RegExp(
    `\\[data-theme='${theme}'\\]\\s+\\.text-fg\\\\/(\\d+)\\s*\\{[^}]*?rgb\\(var\\(--fg\\)\\s*/\\s*([\\d.]+)\\)`,
    'gs'
  )
  for (const m of css.matchAll(re)) map.set(Number(m[1]) / 100, Number(m[2]))
  return map
}

const lin = (c) => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const composite = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
const contrast = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05)
}

const THEMES = [
  { name: 'midnight', selector: "\\[data-theme='midnight'\\]" },
  { name: 'carbon', selector: "\\[data-theme='carbon'\\]" },
  { name: 'nebula', selector: "\\[data-theme='nebula'\\]" },
  { name: 'daylight', selector: "\\[data-theme='daylight'\\]" }
]

let checks = 0
for (const { name, selector } of THEMES) {
  const vars = readTheme(selector)
  if (!vars) {
    fail(`theme "${name}" not found in index.css`)
    continue
  }
  const fg = vars['--fg']
  if (!fg) {
    fail(`theme "${name}" has no --fg`)
    continue
  }
  const overrides = readOverrides(name)

  for (const surfaceVar of SURFACE_VARS) {
    const surface = vars[surfaceVar]
    if (!surface) continue
    for (const tier of TEXT_TIERS) {
      const alpha = overrides.get(tier) ?? tier
      const ratio = contrast(composite(fg, surface, alpha), surface)
      checks++
      if (ratio < AA_NORMAL) {
        fail(
          `${name} · text-fg/${tier * 100} on ${surfaceVar} → ${ratio.toFixed(2)}:1 ` +
            `(needs ${AA_NORMAL}:1${overrides.has(tier) ? `, rendered at alpha ${alpha}` : ''})`
        )
      }
    }
  }

  // Accent buttons: the label must be readable on the accent fill. Accents that
  // point at theme variables (cream) are resolved against this theme's values.
  for (const m of css.matchAll(/\[data-accent='(\w+)'\]\s*\{([^}]*)\}/gs)) {
    const [, accentName, body] = m
    const resolve = (prop) => {
      const literal = body.match(new RegExp(`${prop}:\\s*([\\d]+\\s+[\\d]+\\s+[\\d]+)\\s*;`))
      if (literal) return literal[1].split(/\s+/).map(Number)
      const ref = body.match(new RegExp(`${prop}:\\s*var\\((--[\\w-]+)\\)`))
      return ref ? vars[ref[1]] : null
    }
    const accent = resolve('--accent')
    const accentFg = resolve('--accent-fg')
    if (!accent || !accentFg) continue
    const ratio = contrast(accent, accentFg)
    checks++
    if (ratio < AA_NORMAL) {
      fail(
        `accent "${accentName}" label on ${name} → ${ratio.toFixed(2)}:1 (needs ${AA_NORMAL}:1)`
      )
    }
  }
}

if (process.exitCode) {
  console.error(`\n${checks} combinations checked — see failures above.`)
} else {
  console.log(`✓ ${checks} theme/tier combinations all clear ${AA_NORMAL}:1`)
}
