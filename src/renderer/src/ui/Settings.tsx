import { createContext, useContext, useId, type ReactNode } from 'react'
import { cx } from './cx'

/** The id of the row's title, for the control inside to be named by. */
export const SettingsRowLabel = createContext<string | undefined>(undefined)

/** The title id of the SettingsRow this control sits in. */
export function useSettingsRowLabel(): string | undefined {
  return useContext(SettingsRowLabel)
}

interface GroupProps {
  /** A short sentence-case heading above the card. */
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Settings rows grouped into one `--r-3` card with soft dividers (plan 3.1,
 * used by Settings in 5.1). The heading sits outside the card, in body text,
 * not mono uppercase.
 */
export function SettingsGroup({ title, description, children, className }: GroupProps): JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={title ? id : undefined} className={cx('space-y-2', className)}>
      {title && (
        <div className="px-1">
          <h3 id={id} className="text-section font-semibold text-ink">
            {title}
          </h3>
          {description && <p className="text-meta text-ink-2">{description}</p>}
        </div>
      )}
      <div className="ui-settings-group">{children}</div>
    </section>
  )
}

interface RowProps {
  title: ReactNode
  hint?: ReactNode
  /** The control: a Switch, SegmentedControl, Button… named by the row's title. */
  children?: ReactNode
  /** Put the control under the text instead of beside it (wide controls). */
  stacked?: boolean
}

/** One setting: title, optional hint, and its control on the right (or below). */
export function SettingsRow({ title, hint, children, stacked }: RowProps): JSX.Element {
  const id = useId()
  return (
    <SettingsRowLabel.Provider value={id}>
      <div className={cx('ui-settings-row', stacked && 'flex-col items-stretch')}>
        <div className="min-w-0 flex-1">
          <div id={id} className="text-body text-ink">
            {title}
          </div>
          {hint && <div className="mt-0.5 text-meta text-ink-2">{hint}</div>}
        </div>
        {children && <div className={cx('shrink-0', stacked && 'w-full')}>{children}</div>}
      </div>
    </SettingsRowLabel.Provider>
  )
}
