/**
 * Derive the accent tokens (A1 §1, A1.2 Y1): fill, ink and label for each of
 * GNOME's ten accents as Ubuntu 26.04 draws them, Yaru orange as "orange".
 *
 *   node scripts/accents.mjs          # print the table
 *   node scripts/accents.mjs --css    # print the index.css blocks
 *
 * The rule, all in OKLab so the hue stays put:
 *  - fill: the GNOME colour, darkened (L only) until white text on it reaches 4.5:1;
 *  - ink (accent-coloured text) in Day: L capped at 0.5, then darkened until it
 *    reaches 4.5:1 on every Day plane;
 *  - ink in Night: L raised to at least 0.85, then lightened until 4.5:1 on
 *    every Night plane.
 * check-contrast.mjs then gates whatever lands in index.css.
 */
import { pathToFileURL } from 'url'

/*
  The accents as Ubuntu 26.04 draws them (GNOME 50, libadwaita 1.9 with Yaru):
  Ubuntu's libadwaita overrides GNOME's palette with Yaru's own colours, and
  GNOME 50 adds a tenth, brown. Read from the installed libadwaita stylesheet
  (`--accent-*` in default-light-yaru-default.css), values only.
*/
export const GNOME_ACCENTS = {
  blue: [0, 115, 229],
  teal: [48, 130, 128],
  green: [75, 133, 1],
  yellow: [200, 136, 0],
  // Ubuntu's orange (#E95420), the Yaru accent and the default.
  orange: [233, 84, 32],
  red: [218, 52, 80],
  pink: [179, 76, 179],
  purple: [119, 100, 216],
  slate: [101, 123, 105],
  // New in GNOME 50; Ubuntu's Yaru "warty brown".
  brown: [179, 145, 105]
}

const toLin = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLin = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}
export function toOklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(toLin)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}
export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}
export const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** OKLCh hue in degrees. */
export const hue = (rgb) => {
  const [, a, b] = toOklab(rgb)
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

const withL = (rgb, L) => {
  const [, a, b] = toOklab(rgb)
  return fromOklab([L, a, b])
}

const WHITE = [255, 255, 255]

/** Planes accent ink may sit on (index.css): bg, surface, card, sidebar, sidebar-2, popover. */
export const PLANES = {
  day: [
    [250, 250, 250],
    [255, 255, 255],
    [235, 235, 235],
    [243, 243, 243]
  ],
  night: [
    [44, 44, 44],
    [61, 61, 61],
    [57, 57, 57],
    [50, 50, 50],
    [56, 56, 56]
  ]
}

export function derive(rgb) {
  let fill = rgb
  for (let L = toOklab(rgb)[0]; contrast(fill, WHITE) < 4.5; L -= 0.005) fill = withL(rgb, L)
  const minOn = (c, planes) => Math.min(...planes.map((p) => contrast(c, p)))
  let inkDay = withL(rgb, Math.min(0.5, toOklab(rgb)[0]))
  for (let L = toOklab(inkDay)[0]; minOn(inkDay, PLANES.day) < 4.5; L -= 0.005) inkDay = withL(rgb, L)
  let inkNight = withL(rgb, Math.max(0.85, toOklab(rgb)[0]))
  for (let L = toOklab(inkNight)[0]; minOn(inkNight, PLANES.night) < 4.5; L += 0.005) inkNight = withL(rgb, L)
  return { fill, inkDay, inkNight }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const css = process.argv.includes('--css')
  for (const [name, rgb] of Object.entries(GNOME_ACCENTS)) {
    const { fill, inkDay, inkNight } = derive(rgb)
    if (css) {
      console.log(`  ${name}: fill ${fill.join(' ')} · day ink ${inkDay.join(' ')} · night ink ${inkNight.join(' ')}`)
    } else {
      console.log(
        name.padEnd(7),
        rgb.join(' ').padEnd(12),
        '→ fill',
        fill.join(' ').padEnd(12),
        contrast(fill, WHITE).toFixed(2),
        '| ink day',
        inkDay.join(' ').padEnd(12),
        '| ink night',
        inkNight.join(' ').padEnd(12),
        '| hue',
        hue(fill).toFixed(0)
      )
    }
  }
}
