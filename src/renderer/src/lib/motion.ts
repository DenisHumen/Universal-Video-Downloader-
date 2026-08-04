import type { Transition, Variants } from 'framer-motion'

/**
 * One motion vocabulary for the whole app.
 *
 * The system's register is restrained: motion exists to explain where content
 * came from, never to decorate. Everything shares one curve — decelerate,
 * emphasised: off the mark immediately, landing soft — and there are only three
 * durations. Defining them once is what makes separate screens feel like the
 * same product; per-component springs invented ad hoc are what makes an app
 * feel assembled from parts.
 *
 * Deliberately absent: sliding indicators behind selected items, sweeping
 * shimmer gradients, and anything that animates continuously while idle.
 */

/** Decelerate-emphasised — the app's single easing curve. */
export const EASE = [0.2, 0, 0, 1] as const

/** Micro-interactions: hover, colour, small reveals. */
export const quick: Transition = { duration: 0.16, ease: EASE }

/** Entering content: view switches, results appearing. */
export const enter: Transition = { duration: 0.24, ease: EASE }

/** Height reveals — disclosure rows, expanding drawers. */
export const reveal: Transition = { duration: 0.32, ease: EASE }

/**
 * Dialogs. A spring, but a damped one: it should feel like the panel has mass,
 * not like it bounced off something.
 */
export const modalSpring: Transition = { type: 'spring', damping: 30, stiffness: 320 }

/** Queue rows reordering. */
export const listItem: Transition = { type: 'spring', damping: 32, stiffness: 340 }

/**
 * A grid or list revealing itself. The step is small on purpose — a long
 * cascade reads as slowness, not as craft.
 */
export const staggerParent: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.03, delayChildren: 0.02 } }
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } }
}

/** The app's one entrance: rise a little and fade in. Used by every view. */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: enter
}

/** Modal backdrop + panel, used by every dialog in the app. */
export const overlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: quick
}

export const dialog = {
  initial: { opacity: 0, y: 10, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 10, scale: 0.98 },
  transition: modalSpring
}

/** Collapsible sections — height + opacity, nothing else. */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: reveal
}
