import { describe, expect, it } from 'vitest'
import { contrast, deriveAccent, isAccentChoice, parseColor, type Rgb } from './accent'

const NIGHT: Rgb[] = [
  [10, 10, 13],
  [20, 20, 24],
  [28, 28, 33],
  [34, 34, 40]
]
const DAY: Rgb[] = [
  [238, 238, 242],
  [255, 255, 255],
  [246, 246, 249],
  [255, 255, 255]
]

describe('accent choice', () => {
  it('knows the shipped accents and system', () => {
    expect(isAccentChoice('violet')).toBe(true)
    expect(isAccentChoice('system')).toBe(true)
    expect(isAccentChoice('neon')).toBe(false)
  })

  it('reads the colour formats it is handed', () => {
    expect(parseColor('#0078d4')).toEqual([0, 120, 212])
    expect(parseColor('0078d4ff')).toEqual([0, 120, 212])
    expect(parseColor('61 99 255')).toEqual([61, 99, 255])
    expect(parseColor('nope')).toBeNull()
  })
})

describe('deriveAccent (system accent)', () => {
  const cases: [string, Rgb][] = [
    ['Windows blue', [0, 120, 212]],
    ['a pale yellow', [255, 235, 120]],
    ['a dark green', [16, 80, 40]],
    ['mid grey', [128, 128, 128]],
    ['pure red', [255, 0, 0]]
  ]
  it.each(cases)('clamps %s until it passes the gate in both themes', (_, source) => {
    for (const [planes, dark, night] of [
      [NIGHT, [10, 10, 13] as Rgb, true],
      [DAY, [12, 12, 16] as Rgb, false]
    ] as const) {
      const out = deriveAccent(source, [...planes], dark, night)
      expect(out).not.toBeNull()
      expect(contrast(out!.fill, out!.fg)).toBeGreaterThanOrEqual(4.5)
      for (const p of planes) expect(contrast(out!.ink, p)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
