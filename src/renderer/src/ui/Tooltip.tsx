import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'

/** Hover or focus this long before a tooltip appears (plan 3.1). */
export const TOOLTIP_DELAY = 500

interface Props {
  label: string
  /** One focusable element; it gains `aria-describedby` while the tip shows. */
  children: ReactElement
  side?: 'bottom' | 'top' | 'right'
  /** When the label is already the element's accessible name, it is not repeated as a description. */
  describes?: boolean
}

type Place = { top: number; left: number; transform: string }

/**
 * A short label for a control, after 500 ms of hover or keyboard focus.
 * Replaces `title`, which shows late, unstyled and never on focus.
 *
 * Positioned once when it opens (fixed, from the trigger's rect), in a portal
 * so a clipping parent cannot cut it; Esc or leaving hides it. No frame-clock
 * motion: it appears on the next render, nothing animates.
 */
export default function Tooltip({ label, children, side = 'bottom', describes = false }: Props): JSX.Element {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const anchor = useRef<HTMLElement | null>(null)

  const hide = (): void => {
    clearTimeout(timer.current)
    setPlace(null)
  }

  const show = (target: HTMLElement): void => {
    anchor.current = target
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = target.getBoundingClientRect()
      if (side === 'right') {
        setPlace({ top: r.top + r.height / 2, left: r.right + 8, transform: 'translateY(-50%)' })
      } else if (side === 'top' || r.bottom + 40 > window.innerHeight) {
        setPlace({ top: r.top - 6, left: r.left + r.width / 2, transform: 'translate(-50%, -100%)' })
      } else {
        setPlace({ top: r.bottom + 6, left: r.left + r.width / 2, transform: 'translateX(-50%)' })
      }
    }, TOOLTIP_DELAY)
  }

  useEffect(() => {
    if (!place) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, true)
    }
  }, [place])

  useEffect(() => () => clearTimeout(timer.current), [])

  const props = children.props as Record<string, unknown>
  const chain =
    <E,>(own: unknown, mine: (e: E) => void) =>
    (e: E): void => {
      mine(e)
      if (typeof own === 'function') (own as (e: E) => void)(e)
    }

  return (
    <>
      {cloneElement(children, {
        onMouseEnter: chain<MouseEvent<HTMLElement>>(props.onMouseEnter, (e) => show(e.currentTarget)),
        onMouseLeave: chain<MouseEvent<HTMLElement>>(props.onMouseLeave, hide),
        onFocus: chain<FocusEvent<HTMLElement>>(props.onFocus, (e) => {
          if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget)
        }),
        onBlur: chain<FocusEvent<HTMLElement>>(props.onBlur, hide),
        onPointerDown: chain<MouseEvent<HTMLElement>>(props.onPointerDown, hide),
        'aria-describedby': place && describes ? id : (props['aria-describedby'] as string | undefined)
      })}
      {place &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="ui-tooltip"
            style={{ top: place.top, left: place.left, transform: place.transform, zIndex: 'var(--z-overlay)' }}
          >
            {label}
          </div>,
          document.body
        )}
    </>
  )
}
