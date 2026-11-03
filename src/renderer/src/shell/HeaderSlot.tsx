import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The content header bar's slot for a view's own actions (Shell renders the target). */
export const HEADER_END_ID = 'uvd-header-end'
/** The centre of the bar, for a view whose title is a control (Search's entry, A1 §3). */
export const HEADER_CENTER_ID = 'uvd-header-center'

/**
 * A view's actions in the content header bar, at the end before the caption
 * buttons - GNOME's "Pause All" in Activity, "Paste Several Links…" in
 * Download (A1.1 §3). A portal, so the view keeps owning its state and the
 * shell keeps owning the bar.
 */
export default function HeaderSlot({ children, where = 'end' }: { children: ReactNode; where?: 'end' | 'center' }): JSX.Element | null {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setTarget(document.getElementById(where === 'center' ? HEADER_CENTER_ID : HEADER_END_ID)), [where])
  return target ? createPortal(children, target) : null
}
