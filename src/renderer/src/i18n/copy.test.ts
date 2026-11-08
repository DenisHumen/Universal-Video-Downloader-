import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import type { TranslationKey } from './en'

/*
  D7 (GNOME HIG): English titles, buttons, menu items and sidebar rows use
  header capitalisation; subtitles and descriptions stay in sentence case; a
  label that opens more input ends with "…"; no label ends with a full stop.
  Russian is in sentence case throughout.
*/

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'to', 'as', 'at', 'by', 'in', 'of', 'on', 'from', 'with'])

/** Every word capitalised except the small ones in the middle. */
function isHeaderCaps(text: string): boolean {
  const words = text.split(/[\s—→/·]+/).filter((w) => /^[A-Za-z]/.test(w))
  return words.every((w, i) => {
    const small = SMALL.has(w.toLowerCase()) && i > 0 && i < words.length - 1
    return small ? w === w.toLowerCase() : w[0] === w[0].toUpperCase()
  })
}

/** Buttons, menu items, titles and sidebar rows the shell and settings show. */
const LABELS: TranslationKey[] = [
  'nav.home',
  'nav.search',
  'nav.queue',
  'nav.automation',
  'nav.settings',
  'shell.mainMenu',
  'shell.about',
  'shortcuts.title',
  'browser.open',
  'common.cancel',
  'common.showInFolder',
  'common.change',
  'queue.pauseAll',
  'queue.clearFinished',
  'queue.more',
  'home.get',
  'home.batchOpen'
]

describe('copy (D7)', () => {
  it.each(LABELS)('%s is in English header capitalisation', (key) => {
    expect(isHeaderCaps(en[key]), en[key]).toBe(true)
  })

  it.each(LABELS)('%s is in Russian sentence case', (key) => {
    expect(ru[key][0]).toBe(ru[key][0].toUpperCase())
  })

  it('ends a label that opens more input with an ellipsis, in both languages', () => {
    for (const key of ['common.change', 'home.batchOpen'] as TranslationKey[]) {
      expect(en[key].endsWith('…'), key).toBe(true)
      expect(ru[key].endsWith('…'), key).toBe(true)
    }
  })

  /*
    A header toggle that switches the view into a mode asks for nothing more,
    so it has no ellipsis - and one in a header read as a truncated label.
  */
  it('keeps header-bar actions short and without an ellipsis, in both languages', () => {
    for (const key of ['home.batchHeader', 'queue.pauseAll', 'queue.resumeAll'] as TranslationKey[]) {
      for (const dict of [en, ru]) {
        expect(dict[key].endsWith('…'), key).toBe(false)
        expect(dict[key].length, key).toBeLessThanOrEqual(18)
      }
    }
  })

  it('puts no full stop at the end of a label', () => {
    for (const key of LABELS) expect(en[key].endsWith('.'), key).toBe(false)
  })
})

/*
  5.8: every string is written in its final case. Nothing recases at display
  time any more (lib/caps.ts and settings/text.ts went), so a string that
  starts in lower case is shown in lower case.
*/
describe('copy pass (5.8)', () => {
  // Fragments composed into a sentence, units, placeholders that show what to type, and lines in a terminal.
  const FRAGMENT = /^(cli\.|time\.|settings\.proxyPlaceholder$|auto\.(in|ago)$|shortcuts\.or$|format\.plusAudio$|main\.netReason\.)/

  it.each([
    ['en', en],
    ['ru', ru]
  ] as const)('%s starts every sentence and label with a capital', (_lang, dict) => {
    const lower = Object.entries(dict)
      .filter(([key]) => !FRAGMENT.test(key))
      .flatMap(([key, value]) => (value as string).split('|').map((form) => [key, form] as const))
      .filter(([, form]) => /^\p{Ll}/u.test(form) && !/^(uvd|yt-dlp|macOS|cookies\.txt|iOS)\b/.test(form))
      .map(([key]) => key)
    expect(lower).toEqual([])
  })

  it('has no display-time recasing shim left', async () => {
    const { readdirSync, existsSync } = await import('fs')
    const { join } = await import('path')
    expect(existsSync(join(__dirname, '../lib/caps.ts'))).toBe(false)
    expect(readdirSync(join(__dirname, '../views/settings'))).not.toContain('text.ts')
  })
})
