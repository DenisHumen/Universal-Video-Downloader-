import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The content header bar's slot for a view's own actions (Shell renders the target). */
export const HEADER_END_ID = 'uvd-header-end'

/**
 * A view's actions in the content header bar, at the end before the caption
 * buttons - GNOME's "Pause All" in Activity, "Paste Several Links…" in
 * Download (A1.1 §3). A portal, so the view keeps owning its state and the
 * shell keeps owning the bar.
 */
export default function HeaderSlot({ children }: { children: ReactNode }): JSX.Element | null {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setTarget(document.getElementById(HEADER_END_ID)), [])
  return target ? createPortal(children, target) : null
}
