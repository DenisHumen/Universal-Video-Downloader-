import type { EscapeLike } from './shortcuts'

/**
 * The open dialogs, top-most last, and the rules for which of them a key
 * belongs to. Kept apart from React and the DOM so the rules can be tested
 * without either.
 *
 * Dialogs stack: a confirmation can open over the step editor, the shortcut
 * list over anything. Each dialog used to listen on the window for itself, so
 * one Esc reached every dialog that happened to listen and closed them all at
 * once, while most dialogs did not listen at all and Tab walked straight out of
 * every one of them except ConfirmDialog.
 */

export interface ModalEntry {
  /** Close the dialog, exactly as its own close button would. */
  close: () => void
}

const stack: ModalEntry[] = []

/** Put a dialog on top of the stack, as it opens. */
export function pushModal(entry: ModalEntry): void {
  removeModal(entry)
  stack.push(entry)
}

/**
 * Take a dialog off the stack, wherever it is.
 *
 * Not only from the top: a dialog underneath can close on its own, the way the
 * step editor does when the save it was waiting for finishes while a
 * confirmation sits over it.
 */
export function removeModal(entry: ModalEntry): void {
  const at = stack.indexOf(entry)
  if (at !== -1) stack.splice(at, 1)
}

/** The dialog that keys belong to, if any is open. */
export function topModal(): ModalEntry | undefined {
  return stack[stack.length - 1]
}

/*
  A list or a menu open over a dialog: a drop-down in the step editor, the dub
  picker in Add Series. It is drawn outside the dialog and it is what the keys
  belong to while it is open. The dialogs' listener runs first, in the capture
  phase, so without this an Esc meant for the list closed the whole dialog -
  and the form typed into it - and a Tab was sent back to the dialog's first
  control.
*/
let floating = 0

/** A popover opened; call the returned function when it closes. */
export function holdKeysForPopover(): () => void {
  floating++
  let released = false
  return () => {
    if (released) return
    released = true
    floating--
  }
}

/** Whether a popover is open, and so has the keyboard ahead of any dialog. */
export function popoverHasKeys(): boolean {
  return floating > 0
}

/** How many dialogs are open. */
export function openModals(): number {
  return stack.length
}

/**
 * Whether this keydown is an Esc the top dialog should answer.
 *
 * Not one something earlier already spent, and not one in the middle of an
 * input method's composition, where Esc cancels the composition instead.
 */
export function claimsEscape(e: EscapeLike): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing
}

/**
 * Where Tab should send focus inside a dialog, as an index into its focusable
 * controls, or null to let the browser move focus itself.
 *
 * `current` is the focused control's index, or -1 when focus is not on one of
 * them: on the panel itself, or anywhere behind the dialog. The browser is left
 * alone everywhere except the two ends, so a dialog's own tab order still
 * decides everything in between.
 */
export function trapTarget(count: number, current: number, backwards: boolean): number | null {
  if (count <= 0) return null
  if (current < 0 || current >= count) return backwards ? count - 1 : 0
  if (backwards && current === 0) return count - 1
  if (!backwards && current === count - 1) return 0
  return null
}
