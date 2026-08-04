/**
 * WCAG contrast gate for the theme palettes.
 *
 * The design system names three text tiers outright (--text, --text-2,
 * --text-3) plus three status colours, and each of them can land on any of the
 * three planes (--bg, --surface, --surface-2). That's a matrix no browser
 * spot-check covers: you only ever look at one theme on one plane at a time,
 * and "just darkening a grey a little" is exactly how a tier slips under AA
 * on the one surface you didn't open.
 *
 * This reads the real values out of index.css — so it cannot drift from the
 * stylesheet — and fails if any pairing lands under 4.5:1.
 *
 * Run: node scripts/check-contrast.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/src/index.css'), 'utf-8')

const AA_NORMAL = 4.5

/** Everything that is ever painted as text. */
const TEXT_VARS = ['--text', '--text-2', '--text-3', '--accent-ink', '--good', '--warn', '--bad']
/** Every plane text can sit on. */
const PLANE_VARS = ['--bg', '--surface', '--surface-2']

const THEMES = [
  { name: 'night', selector: "\\[data-theme='night'\\]" },
  { name: 'day', selector: "\\[data-theme='day'\\]" }
]

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

/** Pull every `--name: r g b` out of a theme block. */
function readTheme(selector) {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 's'))
  if (!block) return null
  const vars = {}
  for (const m of block[1].matchAll(/(--[\w-]+):\s*(\d+\s+\d+\s+\d+)\s*;/g)) {
    vars[m[1]] = m[2].split(/\s+/).map(Number)
  }
  return vars
}

const lin = (c) => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05)
}

let checks = 0
let worst = { ratio: Infinity, what: '' }

for (const { name, selector } of THEMES) {
  const vars = readTheme(selector)
  if (!vars) {
    fail(`theme "${name}" not found in index.css`)
    continue
  }

  for (const textVar of TEXT_VARS) {
    const text = vars[textVar]
    if (!text) {
      fail(`theme "${name}" is missing ${textVar}`)
      continue
    }
    for (const planeVar of PLANE_VARS) {
      const plane = vars[planeVar]
      if (!plane) {
        fail(`theme "${name}" is missing ${planeVar}`)
        continue
      }
      const ratio = contrast(text, plane)
      checks++
      const what = `${name} · ${textVar} on ${planeVar}`
      if (ratio < worst.ratio) worst = { ratio, what }
      if (ratio < AA_NORMAL) {
        fail(`${what} → ${ratio.toFixed(2)}:1 (needs ${AA_NORMAL}:1)`)
      }
    }
  }

  // The label on an accent fill — the one place text sits on the brand colour.
  if (vars['--accent'] && vars['--accent-fg']) {
    const ratio = contrast(vars['--accent'], vars['--accent-fg'])
    checks++
    const what = `${name} · --accent-fg on --accent`
    if (ratio < worst.ratio) worst = { ratio, what }
    if (ratio < AA_NORMAL) fail(`${what} → ${ratio.toFixed(2)}:1 (needs ${AA_NORMAL}:1)`)
  }
}

if (process.exitCode) {
  console.error(`\n${checks} pairings checked — see failures above.`)
} else {
  console.log(
    `✓ ${checks} theme/text/plane pairings all clear ${AA_NORMAL}:1 ` +
      `(tightest: ${worst.what} at ${worst.ratio.toFixed(2)}:1)`
  )
}
