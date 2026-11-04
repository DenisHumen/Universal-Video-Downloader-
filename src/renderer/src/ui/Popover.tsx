import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

/**
 * The one positioning and focus implementation for anything that floats next
 * to its trigger: menus, pickers, popovers (plan 3.1). Lifted from RowMenu
 * (flip upwards near the bottom, outside click, Esc stops here and returns
 * focus) and Modal (focus in on open, back on close).
 *
 * Placed once, on open, from the trigger's rect: `position: fixed` in a
 * portal, so neither a scrolling list nor an `overflow: hidden` card can clip
 * it. It closes on scroll or resize rather than chasing its trigger on the
 * frame clock: nothing here runs on requestAnimationFrame.
 */

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement>
  onClick: () => void
  'aria-expanded': boolean
  'aria-controls': string | undefined
  'aria-haspopup': 'menu' | 'dialog' | 'listbox'
}

export interface UsePopover {
  open: boolean
  setOpen: (open: boolean) => void
  /** Close and, for a keyboard close, put focus back on the trigger. */
  close: (refocus: boolean) => void
  triggerRef: RefObject<HTMLButtonElement>
  panelRef: RefObject<HTMLDivElement>
  id: string
  triggerProps: (popup?: PopoverTriggerProps['aria-haspopup']) => PopoverTriggerProps
}

export function usePopover(): UsePopover {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false)
    }
    const onScroll = (e: Event): void => {
      if (!panelRef.current?.contains(e.target as Node)) close(false)
    }
    const onResize = (): void => close(false)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  return {
    open,
    setOpen,
    close,
    triggerRef,
    panelRef,
    id,
    triggerProps: (popup = 'dialog') => ({
      ref: triggerRef,
      onClick: () => setOpen((v) => !v),
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      'aria-haspopup': popup
    })
  }
}

/** Room a panel wants below its trigger before it opens upwards instead. */
const ROOM_BELOW = 240
const GAP = 4
/** What a fitted panel keeps clear of the window edge. */
const EDGE = 12

interface PopoverProps {
  state: UsePopover
  children: ReactNode
  /** Which trigger edge the panel lines up with. */
  align?: 'start' | 'end'
  role?: string
  label?: string
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Focus the first focusable thing inside on open (a menu does its own). */
  autoFocus?: boolean
  /** Cap the panel at the room it has and let it scroll (a long list). */
  fit?: boolean
}

export default function Popover({
  state,
  children,
  align = 'end',
  role = 'dialog',
  label,
  className,
  onKeyDown,
  autoFocus = true,
  fit = false
}: PopoverProps): JSX.Element | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!state.open) {
      setStyle(null)
      return
    }
    const r = state.triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const up = window.innerHeight - r.bottom < ROOM_BELOW && r.top > window.innerHeight - r.bottom
    setStyle({
      position: 'fixed',
      zIndex: 'var(--z-overlay)' as unknown as number,
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }),
      ...(fit && {
        maxHeight: Math.max(120, (up ? r.top : window.innerHeight - r.bottom) - GAP - EDGE),
        overflowY: 'auto' as const,
        minWidth: r.width
      })
    })
  }, [state.open, state.triggerRef, align, fit])

  useEffect(() => {
    if (!state.open || !style || !autoFocus) return
    const first = state.panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
  }, [state.open, style, autoFocus, state.panelRef])

  if (!state.open || !style) return null
  return createPortal(
    <div
      ref={state.panelRef}
      id={state.id}
      role={role}
      aria-label={label}
      style={style}
      className={cx('surface-float', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Esc closes this and nothing under it (a dialog, a cleared field).
          e.preventDefault()
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          state.close(true)
          return
        }
        onKeyDown?.(e)
      }}
    >
      {children}
    </div>,
    document.body
  )
}
