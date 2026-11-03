import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface RowMenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
}

/** Menu height past which it opens upwards instead, so the last rows' menus are not cut off. */
const ROOM_BELOW = 240

/**
 * A row's secondary actions behind "⋯".
 *
 * The queue row used to show every action it had as its own icon - up to
 * eight on a finished download - so the row's own primary action was one of
 * eight equal squares, and on a narrow window the title got ten characters.
 * The primary action and remove stay on the row; the rest live here.
 *
 * A real menu for keyboards and screen readers: the trigger says it opens one
 * and whether it is open, focus moves into the menu on open and back to the
 * trigger on Esc, the arrow keys, Home and End move between items, and Tab or
 * a click anywhere else closes it. Esc is stopped here so it cannot also
 * clear or close whatever screen the row sits on.
 */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [upwards, setUpwards] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const focusItem = (index: number): void => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!buttons?.length) return
    buttons[(index + buttons.length) % buttons.length].focus()
  }

  useEffect(() => {
    if (!open) return
    focusItem(0)
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer, true)
    return () => window.removeEventListener('pointerdown', onPointer, true)
  }, [open])

  if (!items.length) return null

  const toggle = (): void => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect()
      setUpwards(Boolean(rect && window.innerHeight - rect.bottom < ROOM_BELOW))
    }
    setOpen((v) => !v)
  }

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(at + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(at - 1)
        break
      case 'Home':
        e.preventDefault()
        focusItem(0)
        break
      case 'End':
        e.preventDefault()
        focusItem(buttons.length - 1)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        close(true)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        className="btn-icon-bare"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`surface-float absolute right-0 min-w-[220px] p-1 ${upwards ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{ zIndex: 'var(--z-nav)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              tabIndex={-1}
              className="flex w-full items-center gap-2.5 rounded-1 px-3 py-2 text-left text-[13px] text-ink-2 outline-none transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink focus:bg-sink focus:text-ink"
              onClick={() => {
                close(true)
                item.onSelect()
              }}
            >
              <span className="shrink-0 text-ink-3">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
