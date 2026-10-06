import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { motion, useIsPresent } from 'framer-motion'
import { dialog, overlay } from '../lib/motion'
import {
  claimsEscape,
  openModals,
  pushModal,
  removeModal,
  topModal,
  trapTarget,
  type ModalEntry
} from '../lib/modalStack'

interface Props {
  children: ReactNode
  /** Esc, a click on the backdrop, and whatever close button the dialog draws. */
  onClose: () => void
  /** The id of the heading that names the dialog. */
  labelledBy?: string
  /** The name itself, for a dialog whose heading lives in a component it cannot give an id to. */
  label?: string
  describedBy?: string
  /** `alertdialog` for a question that interrupts, like "remove this?". */
  role?: 'dialog' | 'alertdialog'
  /** What to focus first, when the first field or button is the wrong place to start. */
  initialFocus?: RefObject<HTMLElement>
  /** The panel's own classes: width, layout, overflow. */
  className?: string
  /** The shortcut list sits a layer above the other dialogs. */
  layer?: 'modal' | 'overlay'
}

/** Everything Tab can land on. */
const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Somewhere to type or choose, which is where a dialog with a form should start. */
const FIELD =
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])'

/*
  Only what is actually on screen. AddWatchDialog keeps its dub picker mounted
  under `hidden` for an upcoming title, and Tab landing on an invisible select
  is a focus nobody can see.
*/
const shown = (el: HTMLElement): boolean => el.getClientRects().length > 0

const within = (panel: HTMLElement, selector: string): HTMLElement[] =>
  Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(shown)

/*
  One listener for every dialog, in the capture phase, so it runs before the
  screens' own window listeners. Home's Esc clears the link and the result, and
  it checks `defaultPrevented` for exactly this reason: the Esc that closes a
  dialog over Home must not also throw away the video just found.
*/
const panels = new Map<ModalEntry, () => HTMLElement | null>()

function onKey(e: KeyboardEvent): void {
  const top = topModal()
  if (!top) return

  if (claimsEscape(e)) {
    e.preventDefault()
    top.close()
    return
  }
  if (e.key !== 'Tab') return

  const panel = panels.get(top)?.()
  if (!panel) return
  // Asked again on every press: content changes while a dialog is open, as
  // AddWatchDialog's does when the series it looked up arrives.
  const items = within(panel, TABBABLE)
  if (!items.length) {
    e.preventDefault()
    panel.focus()
    return
  }
  const target = trapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)
  if (target == null) return
  e.preventDefault()
  items[target].focus()
}

function register(entry: ModalEntry, panel: () => HTMLElement | null): () => void {
  panels.set(entry, panel)
  pushModal(entry)
  if (openModals() === 1) window.addEventListener('keydown', onKey, { capture: true })
  return () => {
    removeModal(entry)
    panels.delete(entry)
    if (openModals() === 0) window.removeEventListener('keydown', onKey, { capture: true })
  }
}

/**
 * The one dialog shell: backdrop, panel, and the keyboard rules every dialog
 * owes the people using it.
 *
 * - The panel is the dialog, so the role and the name go on it rather than on
 *   the full-screen backdrop, where a screen reader announced an unnamed
 *   dialog the size of the window.
 * - Focus moves in when it opens: to `initialFocus`, else to whatever the
 *   dialog autofocused, else to its first field, else to its first button.
 *   It returns to where it was when the dialog closes.
 * - Tab and Shift+Tab stay inside, and focus that wandered out (a click on the
 *   backdrop puts it on the page) is brought back on the next Tab.
 * - Esc closes the top dialog only.
 *
 * Every dialog had some of this and only ConfirmDialog had all of it: the
 * others let Tab walk onto controls the overlay was covering, and most ignored
 * Esc entirely.
 */
export default function Modal({
  children,
  onClose,
  labelledBy,
  label,
  describedBy,
  role = 'dialog',
  initialFocus,
  className,
  layer = 'modal'
}: Props): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  /*
    The latest onClose without re-running the effect below. Callers pass a new
    arrow on every render, and an effect keyed on it would move focus back to
    the first field each time the parent re-rendered, mid-typing.
  */
  const close = useRef(onClose)
  close.current = onClose
  const present = useIsPresent()
  /*
    Where focus was when the dialog appeared, so it can go back there. Read
    while rendering, before anything inside commits: by the time an effect
    runs, an `autoFocus` field in the dialog has already taken focus, and the
    control that opened the dialog would be lost.

    Read again each time the dialog appears, not once per mount.
    AnimatePresence keeps the same instance when a dialog is reopened during
    its exit animation, as Ctrl+/ pressed twice in quick succession does, and
    by then focus has been handed back to the page and may have moved on.
  */
  const previous = useRef<HTMLElement | null>(null)
  const wasPresent = useRef(false)
  if (present !== wasPresent.current) {
    if (present) previous.current = document.activeElement as HTMLElement | null
    wasPresent.current = present
  }
  // Set by a press that starts on the backdrop itself; see the click handler.
  const pressedBackdrop = useRef(false)

  /*
    The dialog holds the stack, the keyboard and focus while it is present,
    not while it is mounted.

    A dialog animating out under AnimatePresence is closed already. Letting go
    as the exit starts, not when it ends, means the next Esc goes to whatever
    is underneath and focus is back on the page while the panel fades.

    A dialog reopened before that exit finished is the same instance coming
    back, so it has to take all of it again. When this ran once per mount, the
    shortcut list reopened that way ignored Esc, since it was no longer on the
    stack, and let Tab walk onto the page behind it.
  */
  useEffect(() => {
    if (!present) return
    const node = panel.current
    const unregister = register({ close: () => close.current() }, () => panel.current)

    if (node && !node.contains(document.activeElement)) {
      const first =
        initialFocus?.current ??
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        within(node, FIELD)[0] ??
        within(node, TABBABLE)[0] ??
        node
      first.focus()
    }

    return () => {
      unregister()
      // Back where the keyboard was, not at the top of the document - unless
      // that control went away with what the dialog did, like a removed row.
      const back = previous.current
      if (back && back !== document.body && document.contains(back)) {
        back.focus()
        return
      }
      /*
        Nothing to go back to: the search window's episode picker opens after
        a lookup, by which time the button that asked has been disabled and
        dropped focus. Focus must still leave the panel, which lingers through
        its exit animation and would otherwise keep it, invisibly.
      */
      const active = document.activeElement
      if (active instanceof HTMLElement && node?.contains(active)) active.blur()
    }
    // Keyed on presence alone: see `close` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present])

  return (
    <motion.div
      {...overlay}
      className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
      style={{ zIndex: `var(--z-${layer})` }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      /*
        Only a click that both starts and ends on the backdrop. A drag that
        began inside the panel - a trim handle pulled past the panel's edge,
        text selected in a field - ends with a click on the backdrop too, and
        it closed the dialog and dropped everything in it.
      */
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) close.current()
        pressedBackdrop.current = false
      }}
    >
      <motion.div
        {...dialog}
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        // Focusable only by script: the fallback for a dialog with no controls.
        tabIndex={-1}
        className={`${className ?? ''} focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
