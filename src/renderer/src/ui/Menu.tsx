import { useEffect, type KeyboardEvent, type ReactNode } from 'react'
import Popover, { usePopover, type PopoverTriggerProps } from './Popover'
import { cx } from './cx'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** Destructive: drawn in `bad`. */
  danger?: boolean
  disabled?: boolean
}

export type MenuEntry = MenuItem | 'separator'

interface Props {
  /** The menu's accessible name, usually the trigger's label. */
  label: string
  items: MenuEntry[]
  /** Render the trigger with these props spread on a button (an IconButton or a Button). */
  trigger: (props: PopoverTriggerProps) => ReactNode
  align?: 'start' | 'end'
}

const ITEM = '[role="menuitem"]:not([disabled])'

/**
 * A menu of actions behind a trigger (plan 3.1), on the shared Popover.
 *
 * Keyboard and screen reader: the trigger says it opens a menu and whether it
 * is open; focus moves to the first item; arrows, Home and End move; Esc
 * closes and returns focus to the trigger; Tab or a click elsewhere closes.
 * ArrowDown on the trigger opens it.
 */
export default function Menu({ label, items, trigger, align = 'end' }: Props): JSX.Element | null {
  const state = usePopover()

  useEffect(() => {
    if (state.open) focusItem(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open])

  if (!items.length) return null

  function buttons(): HTMLButtonElement[] {
    return [...(state.panelRef.current?.querySelectorAll<HTMLButtonElement>(ITEM) ?? [])]
  }
  function focusItem(index: number): void {
    // The panel mounts in a layout effect after open; wait for it.
    queueMicrotask(() => {
      const list = buttons()
      if (list.length) list[(index + list.length) % list.length].focus()
    })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = buttons()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number): void => {
      e.preventDefault()
      list[(i + list.length) % list.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Tab') state.close(false)
  }

  const props = state.triggerProps('menu')
  return (
    <>
      <span
        className="contents"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !state.open) {
            e.preventDefault()
            state.setOpen(true)
          }
        }}
      >
        {trigger(props)}
      </span>
      <Popover state={state} role="menu" label={label} align={align} onKeyDown={onKey} autoFocus={false} className="ui-menu">
        {items.map((item, i) =>
          item === 'separator' ? (
            <div key={`sep-${i}`} role="separator" className="ui-menu-sep" />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={cx('ui-menu-item', item.danger && 'ui-menu-item-danger')}
              onClick={() => {
                state.close(true)
                item.onSelect()
              }}
            >
              {item.icon && (
                <span className={cx('shrink-0', item.danger ? 'text-bad' : 'text-ink-3')} aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          )
        )}
      </Popover>
    </>
  )
}
