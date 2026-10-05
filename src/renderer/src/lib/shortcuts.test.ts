import { describe, expect, it } from 'vitest'
import { SHORTCUT_ROWS, chordAction, escapeClearsHome, isEditableTarget, linkIn } from './shortcuts'

/*
  The shortcut list used to be its own array, and it fell behind the handler:
  ⌘/Ctrl+N, F and comma all worked and none of them was listed. Adding them as
  rows of their own would have printed the same label twice and given React
  duplicate keys.
*/
describe('shortcut list', () => {
  it('lists every chord the handler answers', () => {
    const printable = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i))
    const listed = new Set(
      SHORTCUT_ROWS.flatMap((row) => row.keys)
        .filter((chord) => chord[0] === 'mod')
        .map((chord) => chord[1].toLowerCase())
    )
    // '?' is Shift+/ - the listed key, reported with Shift held.
    const unlisted = printable.filter((key) => chordAction(key) && key !== '?' && !listed.has(key.toLowerCase()))
    expect(unlisted).toEqual([])
  })

  it('gives every row its own label and every chord one row', () => {
    const labels = SHORTCUT_ROWS.map((row) => row.label)
    expect(new Set(labels).size).toBe(labels.length)
    const chords = SHORTCUT_ROWS.flatMap((row) => row.keys.map((chord) => chord.join('+').toLowerCase()))
    expect(new Set(chords).size).toBe(chords.length)
  })

  it('keeps the aliases on the rows they belong to', () => {
    const row = (label: string): string[][] | undefined => SHORTCUT_ROWS.find((r) => r.label === label)?.keys
    expect(row('shortcuts.newDownload')).toContainEqual(['mod', 'N'])
    expect(row('shortcuts.search')).toContainEqual(['mod', 'F'])
    expect(row('shortcuts.settings')).toContainEqual(['mod', ','])
  })
})

describe('chordAction', () => {
  it('switches views with the digits in tab order', () => {
    expect(['1', '2', '3', '4', '5'].map((key) => chordAction(key))).toEqual([
      'home',
      'search',
      'downloads',
      'automation',
      'settings'
    ])
  })

  it('keeps the letter and comma aliases, with or without Shift', () => {
    expect(chordAction('n')).toBe('home')
    expect(chordAction('F')).toBe('search')
    expect(chordAction(',')).toBe('settings')
    expect(chordAction('/')).toBe('help')
    expect(chordAction('?')).toBe('help')
  })

  it('ignores keys that are not shortcuts', () => {
    expect(chordAction('v')).toBeUndefined()
    expect(chordAction('Enter', 'Enter')).toBeUndefined()
    expect(chordAction('ArrowLeft', 'ArrowLeft')).toBeUndefined()
  })

  // On a Russian layout ⌘/Ctrl+F arrives as 'а', and matched nothing.
  it('finds the key by position when the layout types no Latin letter', () => {
    expect(chordAction('а', 'KeyF')).toBe('search')
    expect(chordAction('Т', 'KeyN')).toBe('home')
    expect(chordAction('б', 'Comma')).toBe('settings')
    expect(chordAction('м', 'KeyV')).toBeUndefined()
  })

  // Dvorak's physical F types 'u': the keycap says U, so U is what was meant.
  it('takes a Latin key at its word on a remapped layout', () => {
    expect(chordAction('u', 'KeyF')).toBeUndefined()
  })
})

/*
  The paste handler skipped INPUT and TEXTAREA only - a paste into a select or
  an editable region would have been taken as "detect this link" too.
*/
describe('isEditableTarget', () => {
  it('counts the elements that take text themselves', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'INPUT', type: 'url' })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  // A focused checkbox has nothing to paste into; Ctrl+V should still detect.
  it('does not count inputs that hold no text', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(false)
  })

  it('does not count the page or a button', () => {
    expect(isEditableTarget({ tagName: 'BODY', isContentEditable: false })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('linkIn', () => {
  it('returns a pasted link trimmed', () => {
    expect(linkIn('  https://example.com/watch?v=1\n')).toBe('https://example.com/watch?v=1')
  })

  it('returns nothing for text that is not a link', () => {
    expect(linkIn('big buck bunny')).toBeNull()
    expect(linkIn('   ')).toBeNull()
    expect(linkIn(undefined)).toBeNull()
  })
})

/*
  Esc on Home cleared the field on every keypress - including the one that
  closed the shortcut list, which threw away the video just found under it.
*/
describe('escapeClearsHome', () => {
  const esc = { key: 'Escape', defaultPrevented: false, isComposing: false }

  it('clears on a plain Esc', () => {
    expect(escapeClearsHome(esc, false)).toBe(true)
  })

  it('leaves Home alone while the shortcut list is open', () => {
    expect(escapeClearsHome(esc, true)).toBe(false)
  })

  it('leaves Home alone when something else already handled the key', () => {
    expect(escapeClearsHome({ ...esc, defaultPrevented: true }, false)).toBe(false)
  })

  it('leaves Esc to an input method mid-composition', () => {
    expect(escapeClearsHome({ ...esc, isComposing: true }, false)).toBe(false)
  })

  it('ignores every other key', () => {
    expect(escapeClearsHome({ ...esc, key: 'Enter' }, false)).toBe(false)
  })
})
