import type { Transition, Variants } from 'framer-motion'

/**
 * One motion vocabulary for the whole app.
 *
 * Everything eases on the same Expo-out curve (fast to leave, slow to settle),
 * modals use one spring, and lists share one stagger. Defining them once is
 * what makes separate screens feel like the same product; per-component
 * springs invented ad hoc are what made it feel assembled.
 */

/** Expo-out — the app's single easing curve. */
export const EASE = [0.16, 1, 0.3, 1] as const

/** Micro-interactions: hover, colour, small reveals. 150–300ms. */
export const quick: Transition = { duration: 0.2, ease: EASE }

/** Entering content: view switches, cards appearing. */
export const enter: Transition = { duration: 0.32, ease: EASE }

/** Dialogs and sheets — enough spring to feel physical, not bouncy. */
export const modalSpring: Transition = { type: 'spring', damping: 20, stiffness: 90 }

/** The sliding pill behind segmented controls and nav items. */
export const pill: Transition = { type: 'spring', damping: 34, stiffness: 420 }

/** Queue cards reordering. */
export const listItem: Transition = { type: 'spring', damping: 28, stiffness: 280 }

/** A grid or list that reveals itself in a wave. */
export const staggerParent: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } }
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: EASE } }
}

/** Modal backdrop + panel, used by every dialog in the app. */
export const overlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: quick
}

export const dialog = {
  initial: { opacity: 0, scale: 0.96, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 14 },
  transition: modalSpring
}
