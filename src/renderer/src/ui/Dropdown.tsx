import { useEffect, useRef, type KeyboardEvent } from 'react'
import Popover, { usePopover } from './Popover'
import { Check, PanDown } from './icons'
import { cx } from './cx'

export interface DropdownOption {
  value: string
  label: string
}

export interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  'aria-label'?: string
  'aria-labelledby'?: string
  disabled?: boolean
  /** `row`: a combo row's dim suffix; `button`: a raised button; `field`: a full-width field. */
  variant?: 'row' | 'button' | 'field'
  className?: string
}

const OPTION = '[role="option"]'

const VARIANT = {
  row: 'ui-dropdown-row',
  button: 'ui-dropdown-button',
  field: 'ui-dropdown-field'
} as const

/**
 * GtkDropDown: a button showing the choice, opening a popover list with a
 * check mark on the chosen item. Replaces the native <select>, whose OS list
 * is drawn by Chromium and looks nothing like GNOME's.
 *
 * Keyboard: the trigger is a combobox; Enter, Space or ArrowDown open the
 * list with focus on the chosen item; arrows, Home, End and a typed letter
 * move; Enter or Space pick; Esc or Tab close.
 */
export default function Dropdown({
  value,
  options,
  onChange,
  disabled,
  variant = 'row',
  className,
  ...aria
}: DropdownProps): JSX.Element {
  const state = usePopover()
  const typed = useRef({ text: '', at: 0 })
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!state.open) return
    queueMicrotask(() => {
      const list = items()
      const chosen = list.find((el) => el.getAttribute('aria-selected') === 'true') ?? list[0]
      chosen?.focus()
      chosen?.scrollIntoView({ block: 'nearest' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open])

  function items(): HTMLElement[] {
    return [...(state.panelRef.current?.querySelectorAll<HTMLElement>(OPTION) ?? [])]
  }

  function pick(next: string): void {
    state.close(true)
    if (next !== value) onChange(next)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLElement)
    const go = (i: number): void => {
      e.preventDefault()
      list[Math.max(0, Math.min(list.length - 1, i))]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'PageDown') go(at + 8)
    else if (e.key === 'PageUp') go(at - 8)
    else if (e.key === 'Tab') state.close(false)
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead, as a native list: letters typed close together add up.
      const now = Date.now()
      const t = typed.current
      t.text = now - t.at < 700 ? t.text + e.key.toLowerCase() : e.key.toLowerCase()
      t.at = now
      const start = t.text.length === 1 ? at + 1 : at
      for (let k = 0; k < options.length; k++) {
        const i = (start + k) % options.length
        if (options[i].label.toLowerCase().startsWith(t.text)) {
          go(i)
          break
        }
      }
    }
  }

  const trigger = state.triggerProps('listbox')
  return (
    <>
      <button
        type="button"
        role="combobox"
        {...trigger}
        {...aria}
        disabled={disabled}
        className={cx('ui-dropdown', VARIANT[variant], className)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !state.open) {
            e.preventDefault()
            state.setOpen(true)
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
        <PanDown size={16} className="shrink-0 text-ink" />
      </button>
      <Popover
        state={state}
        role="listbox"
        label={aria['aria-label']}
        align="end"
        fit
        autoFocus={false}
        onKeyDown={onKey}
        className="ui-dropdown-list"
      >
        {options.map((o) => {
          const selected = o.value === value
          return (
            <div
              key={o.value}
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              className="ui-dropdown-item"
              onClick={() => pick(o.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick(o.value)
                }
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <Check size={16} className={cx('shrink-0', !selected && 'invisible')} />
            </div>
          )
        })}
      </Popover>
    </>
  )
}
