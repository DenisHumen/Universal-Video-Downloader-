import type { KeyboardEvent, ReactNode } from 'react'
import { useRef } from 'react'
import { cx } from './cx'
import { Check } from './icons'

/*
  GNOME Settings' Appearance pickers (A1.1 §2): style tiles (a mini window
  drawn from the theme tokens, check badge, caption) and accent swatches
  (32 px circles; the selected one gets a 2 px ring in --text, ≥ 3:1 on the
  page, and a check). Both are radio groups: one tab stop, arrows move and
  select.
*/

function useRadioKeys<T>(values: T[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent): void => {
    const at = values.indexOf(value)
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (Math.max(0, at) + step + values.length) % values.length
    onChange(values[next])
    refs.current[next]?.focus()
  }
  return { refs, onKeyDown }
}

export type TileStyle = 'day' | 'night' | 'system'

interface StyleTilesProps {
  label: string
  value: TileStyle
  options: { value: TileStyle; label: string }[]
  onChange: (v: TileStyle) => void
}

/** A thumbnail window in one theme (or split, for System), painted from that theme's tokens. */
function Thumbnail({ theme }: { theme: TileStyle }): JSX.Element {
  const half = (t: 'day' | 'night', side?: 'left' | 'right'): ReactNode => (
    <span
      data-theme={t}
      className={cx('ui-tile-window', side === 'left' && 'ui-tile-left', side === 'right' && 'ui-tile-right')}
      aria-hidden="true"
    >
      <span className="ui-tile-sidebar" />
      <span className="ui-tile-content">
        <span className="ui-tile-line" />
        <span className="ui-tile-card" />
        <span className="ui-tile-accent" />
      </span>
    </span>
  )
  if (theme === 'system') {
    return (
      <span className="ui-tile-frame">
        {half('day', 'left')}
        {half('night', 'right')}
      </span>
    )
  }
  return <span className="ui-tile-frame">{half(theme)}</span>
}

export function StyleTiles({ label, value, options, onChange }: StyleTilesProps): JSX.Element {
  const values = options.map((o) => o.value)
  const { refs, onKeyDown } = useRadioKeys(values, value, onChange)
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap justify-center gap-5" onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="ui-style-tile"
            onClick={() => onChange(o.value)}
          >
            <span className="relative">
              <Thumbnail theme={o.value} />
              {on && (
                <span className="ui-tile-check" aria-hidden="true">
                  <Check size={12} />
                </span>
              )}
            </span>
            <span className="text-control text-ink">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export interface SwatchOption {
  value: string
  label: string
}

interface SwatchesProps {
  label: string
  value: string
  options: SwatchOption[]
  onChange: (v: string) => void
}

/**
 * Accent swatches. Each swatch paints its own accent by carrying
 * `data-accent` (the [data-accent] blocks in index.css), so the colour is the
 * same token the app would use; "system" is a multicolour ring.
 */
export function AccentSwatches({ label, value, options, onChange }: SwatchesProps): JSX.Element {
  const values = options.map((o) => o.value)
  const { refs, onKeyDown } = useRadioKeys(values, value, onChange)
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-3" onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            tabIndex={on ? 0 : -1}
            data-accent={o.value === 'system' ? undefined : o.value}
            className={cx('ui-swatch', o.value === 'system' && 'ui-swatch-system')}
            onClick={() => onChange(o.value)}
          >
            {on && <Check size={14} className="text-accent-fg" />}
          </button>
        )
      })}
    </div>
  )
}

/** A count or a percentage in an accent pill (the Activity row and the sidebar toggle). */
export function Badge({ children, label }: { children: ReactNode; label?: string }): JSX.Element {
  return (
    <span className="ui-badge" aria-label={label} role={label ? 'status' : undefined}>
      {children}
    </span>
  )
}
