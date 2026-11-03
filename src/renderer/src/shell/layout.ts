import { useMediaQuery } from '../hooks/useMediaQuery'
import { useStore } from '../store'

/** Below this the app sidebar is an overlay (AdwOverlaySplitView's collapse point, A1). */
export const SIDEBAR_PINNED_FROM = 860
/** Settings has room for its own panel list and the app sidebar side by side from here (A1.1). */
export const THREE_COLUMNS_FROM = 1100

export interface ShellLayout {
  /** The app sidebar sits beside the content. */
  pinned: boolean
  /** The window is narrow (< 860): Settings stacks its panel list as a page. */
  narrow: boolean
  /** 860-1099: Settings folds the app sidebar to keep one rail. */
  medium: boolean
}

/**
 * Never a double rail (A1.1 veto): the app sidebar is pinned from 860 px,
 * except while Settings is open below 1100 px, where Settings' own panel list
 * is the only rail and the app sidebar becomes an overlay (sidebarFolded).
 */
export function useShellLayout(): ShellLayout {
  const wide = useMediaQuery(`(min-width: ${SIDEBAR_PINNED_FROM}px)`)
  const roomy = useMediaQuery(`(min-width: ${THREE_COLUMNS_FROM}px)`)
  const folded = useStore((s) => s.sidebarFolded)
  return { pinned: wide && !folded, narrow: !wide, medium: wide && !roomy }
}
