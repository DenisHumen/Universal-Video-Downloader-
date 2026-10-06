import type { ViewId } from '../store'
import type { TranslationKey } from '../i18n'
import { isProbablyUrl } from './format'

/** What a ⌘/Ctrl chord does: open a screen, or toggle the shortcut list. */
export type ShortcutAction = ViewId | 'help'

export interface ShortcutRow {
  /** One chord per entry; a second entry is an alias for the same thing. */
  keys: string[][]
  label: TranslationKey
  /** Absent where the key is not ours to handle: paste is a clipboard event. */
  action?: ShortcutAction
}

/*
  The shortcut list and the keyboard handler read the same table.

  They used to be two lists, and they drifted: the handler answered ⌘/Ctrl+N,
  ⌘/Ctrl+F and ⌘/Ctrl+comma, and the list never mentioned any of them. An
  alias shares its action's row rather than getting one of its own, which
  would print "settings" twice and hand React two siblings with one key.
*/
export const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: [['mod', '1'], ['mod', 'N']], label: 'shortcuts.newDownload', action: 'home' },
  { keys: [['mod', '2'], ['mod', 'F']], label: 'shortcuts.search', action: 'search' },
  { keys: [['mod', '3']], label: 'shortcuts.queue', action: 'downloads' },
  { keys: [['mod', '4']], label: 'shortcuts.watch', action: 'automation' },
  { keys: [['mod', '5'], ['mod', ',']], label: 'shortcuts.settings', action: 'settings' },
  { keys: [['mod', 'V']], label: 'shortcuts.paste' },
  { keys: [['mod', '/']], label: 'shortcuts.help', action: 'help' },
  { keys: [['Esc']], label: 'shortcuts.escape' }
]

const ACTION_BY_KEY = new Map<string, ShortcutAction>()
for (const row of SHORTCUT_ROWS) {
  if (!row.action) continue
  for (const [modifier, key] of row.keys) {
    if (modifier === 'mod') ACTION_BY_KEY.set(key.toLowerCase(), row.action)
  }
}
// Shift+/ reports itself as '?' - the same physical key, so the same shortcut.
ACTION_BY_KEY.set('?', 'help')

const US_PUNCTUATION = new Map([
  ['Comma', ','],
  ['Slash', '/']
])

/** The character a physical key types on a US layout, from `KeyboardEvent.code`. */
function usKeyOf(code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  return US_PUNCTUATION.get(code)
}

/**
 * What a ⌘/Ctrl chord does, given the event's `key` and `code`.
 *
 * The key is taken at its word whenever it is a Latin character, so AZERTY
 * and Dvorak users get the letter printed on their keycap. On a Cyrillic
 * layout there is no Latin letter to match - ⌘/Ctrl+F arrives as 'а' - and
 * the physical position is the only thing left that means "F".
 */
export function chordAction(key: string, code = ''): ShortcutAction | undefined {
  const direct = ACTION_BY_KEY.get(key.toLowerCase())
  if (direct || /^[\x20-\x7e]$/.test(key)) return direct
  if ([...key].length !== 1) return undefined
  const fallback = usKeyOf(code)
  return fallback ? ACTION_BY_KEY.get(fallback) : undefined
}

/** The parts of an event target the keyboard and clipboard checks look at. */
export interface TargetLike {
  tagName?: string
  type?: string
  isContentEditable?: boolean
}

/** Inputs that hold no text: a checkbox has focus, but nothing to paste into. */
const TEXTLESS_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/** Whether the element takes typed and pasted text itself. */
export function isEditableTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  switch (target.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true
    case 'INPUT':
      return !TEXTLESS_INPUTS.has((target.type ?? 'text').toLowerCase())
    default:
      return false
  }
}

/** The link in pasted or dropped text, or null when it is not one. */
export function linkIn(text: string | null | undefined): string | null {
  const value = text?.trim()
  return value && isProbablyUrl(value) ? value : null
}

/** The parts of a keydown Home's Esc looks at. */
export interface EscapeLike {
  key: string
  defaultPrevented: boolean
  isComposing: boolean
}

/**
 * Whether this keydown should clear Home's link and result.
 *
 * Not when something above Home already answered it - the shortcut list
 * closing on the same Esc used to wipe the video the user had just found -
 * and not mid-composition, where Esc belongs to the input method.
 */
export function escapeClearsHome(e: EscapeLike, overlayOpen: boolean): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !overlayOpen
}
