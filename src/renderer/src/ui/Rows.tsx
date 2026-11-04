import {
  createContext,
  useContext,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { cx } from './cx'
import Switch from './Switch'
import Dropdown from './Dropdown'
import { GoNext, PanDown, ViewConceal, ViewReveal } from './icons'

/*
  libadwaita's preferences family (D3, A1.1 §2): PreferencesPage (a clamped
  column of groups), PreferencesGroup (title, description, an optional
  header suffix, then a boxed list), and the rows: Action, Switch, Combo,
  Expander, Entry, PasswordEntry and a navigation row (chevron, opens a
  subpage). Rows are ≥ 50 px (D0; GNOME Settings' own rows measure ~54 with
  a subtitle), on --card, separated by --line-soft.

  Every row may carry an `id`: deep links (`settings/<panel>#<row>`) scroll it
  into view and pulse it (views/settings/router.ts).
*/

/** The id of the row's title, for the control in it to be named by. */
const RowTitleId = createContext<string | undefined>(undefined)
export const useRowTitleId = (): string | undefined => useContext(RowTitleId)

interface PageProps {
  children: ReactNode
  /** Clamp width; GNOME Settings' column is ~560-600. */
  width?: 'narrow' | 'medium' | 'wide'
  className?: string
}
const WIDTH = { narrow: 'max-w-[600px]', medium: 'max-w-[800px]', wide: 'max-w-[1000px]' }

/** AdwPreferencesPage / AdwClamp: a centred column, 24 px between groups. */
export function PreferencesPage({ children, width = 'narrow', className }: PageProps): JSX.Element {
  return <div className={cx('mx-auto w-full space-y-6 px-3 py-6 sm:px-6', WIDTH[width], className)}>{children}</div>
}

interface GroupProps {
  title?: ReactNode
  description?: ReactNode
  /** On the title line, right-aligned: a flat "+" button, as GNOME's Wired / VPN groups. */
  suffix?: ReactNode
  children?: ReactNode
  id?: string
  /** A caption under the list (field hints, validation errors). */
  footer?: ReactNode
}

export function PreferencesGroup({ title, description, suffix, children, id, footer }: GroupProps): JSX.Element {
  const titleId = useId()
  return (
    <section id={id} data-row={id} aria-labelledby={title ? titleId : undefined} className="space-y-3">
      {(title || suffix) && (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id={titleId} className="text-heading text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-meta text-ink-2">{description}</p>}
          </div>
          {suffix && <div className="-mb-1 shrink-0">{suffix}</div>}
        </div>
      )}
      {children && <div className="ui-boxed-list">{children}</div>}
      {footer && <div className="px-1 text-meta text-ink-2">{footer}</div>}
    </section>
  )
}

interface RowProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Leading widget: a 16 px symbolic icon, a thumbnail. */
  prefix?: ReactNode
  /** Trailing widgets: a switch, a button, a value. */
  suffix?: ReactNode
  /** Makes the whole row a button. */
  onActivate?: () => void
  /** A dim value before the chevron ("Off >"), for a navigation row. */
  value?: ReactNode
  /** Show the go-next chevron: the row opens a subpage. */
  navigation?: boolean
  id?: string
  /** Subtitle in monospace (paths, URLs). */
  monoSubtitle?: boolean
  className?: string
  /** Accessible name when the title is not plain text. */
  label?: string
  disabled?: boolean
}

/** AdwActionRow. With `onActivate` it is one button; otherwise a plain row holding its suffix controls. */
export function ActionRow({
  title,
  subtitle,
  prefix,
  suffix,
  onActivate,
  value,
  navigation,
  id,
  monoSubtitle,
  className,
  label,
  disabled
}: RowProps): JSX.Element {
  const titleId = useId()
  const body = (
    <>
      {prefix && (
        <span className="flex shrink-0 items-center text-ink" aria-hidden={typeof prefix !== 'string'}>
          {prefix}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span id={titleId} className="ui-row-title block">
          {title}
        </span>
        {subtitle && (
          <span className={cx('ui-row-subtitle block break-words', monoSubtitle && 'font-mono')}>{subtitle}</span>
        )}
      </span>
      {value != null && <span className="shrink-0 text-body text-ink-2">{value}</span>}
      {suffix && <span className="flex shrink-0 items-center gap-2">{suffix}</span>}
      {navigation && <GoNext size={16} className="shrink-0 text-ink" />}
    </>
  )
  return (
    <RowTitleId.Provider value={titleId}>
      {onActivate ? (
        <button
          type="button"
          id={id}
          data-row={id}
          aria-label={label}
          disabled={disabled}
          className={cx('ui-row ui-row-activatable', className)}
          onClick={onActivate}
        >
          {body}
        </button>
      ) : (
        <div id={id} data-row={id} className={cx('ui-row', className)}>
          {body}
        </div>
      )}
    </RowTitleId.Provider>
  )
}

interface SwitchRowProps extends Omit<RowProps, 'suffix' | 'onActivate' | 'value' | 'navigation'> {
  checked: boolean
  onChange: (next: boolean) => void
}

/** AdwSwitchRow: the switch is named by the row title; a click anywhere on the row toggles it. */
export function SwitchRow({ checked, onChange, disabled, ...row }: SwitchRowProps): JSX.Element {
  return (
    <ActionRowWithControl
      {...row}
      control={(titleId) => (
        <Switch aria-labelledby={titleId} checked={checked} onChange={onChange} disabled={disabled} />
      )}
    />
  )
}

/** Internal: a non-activatable row whose suffix is named by its title. */
function ActionRowWithControl({
  control,
  ...row
}: Omit<RowProps, 'suffix'> & { control: (titleId: string) => ReactNode }): JSX.Element {
  const id = useId()
  return (
    <div id={row.id} data-row={row.id} className={cx('ui-row', row.className)}>
      {row.prefix && <span className="flex shrink-0 items-center text-ink">{row.prefix}</span>}
      <span className="min-w-0 flex-1">
        <span id={id} className="ui-row-title block">
          {row.title}
        </span>
        {row.subtitle && (
          <span className={cx('ui-row-subtitle block', row.monoSubtitle && 'font-mono')}>{row.subtitle}</span>
        )}
      </span>
      {control(id)}
    </div>
  )
}

export interface ComboOption {
  value: string
  label: string
}

interface ComboRowProps extends Omit<RowProps, 'suffix' | 'onActivate' | 'value' | 'navigation'> {
  value: string
  options: ComboOption[]
  onChange: (value: string) => void
}

/** AdwComboRow: the chosen value, dim, with a drop-down arrow that opens a GNOME list. */
export function ComboRow({ value, options, onChange, ...row }: ComboRowProps): JSX.Element {
  return (
    <ActionRowWithControl
      {...row}
      control={(titleId) => (
        <Dropdown aria-labelledby={titleId} value={value} options={options} onChange={onChange} disabled={row.disabled} />
      )}
    />
  )
}

interface EntryRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'title' | 'id'> {
  title: string
  id?: string
  mono?: boolean
  /** Shown after the field, inside the row (an "Apply" or "Test" button). */
  suffix?: ReactNode
  invalid?: boolean
}

/** AdwEntryRow: the title is the field's label, sitting small above the text. */
export function EntryRow({ title, id, mono, suffix, invalid, className, type = 'text', ...input }: EntryRowProps): JSX.Element {
  const inputId = useId()
  return (
    <div id={id} data-row={id} className={cx('ui-row ui-entry-row', invalid && 'ui-entry-row-invalid', className)}>
      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-text">
        <span className="ui-row-subtitle block">{title}</span>
        <input
          id={inputId}
          type={type}
          aria-invalid={invalid || undefined}
          className={cx('no-drag w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-3', mono && 'font-mono')}
          {...input}
        />
      </label>
      {suffix && <span className="flex shrink-0 items-center gap-2">{suffix}</span>}
    </div>
  )
}

/** AdwPasswordEntryRow: an EntryRow whose text can be shown and hidden. */
export function PasswordEntryRow({ showLabel, hideLabel, ...props }: EntryRowProps & { showLabel: string; hideLabel: string }): JSX.Element {
  const [shown, setShown] = useState(false)
  return (
    <EntryRow
      {...props}
      type={shown ? 'text' : 'password'}
      suffix={
        <>
          {props.suffix}
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn-md"
            aria-label={shown ? hideLabel : showLabel}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <ViewConceal size={16} /> : <ViewReveal size={16} />}
          </button>
        </>
      }
    />
  )
}

interface ExpanderRowProps {
  title: ReactNode
  subtitle?: ReactNode
  /** An enable switch on the row (AdwExpanderRow show-enable-switch). */
  enabled?: boolean
  onEnabledChange?: (next: boolean) => void
  children: ReactNode
  id?: string
  defaultExpanded?: boolean
  expandLabel: string
}

/** AdwExpanderRow: a row that reveals child rows; with an enable switch, the children follow it. */
export function ExpanderRow({
  title,
  subtitle,
  enabled,
  onEnabledChange,
  children,
  id,
  defaultExpanded = false,
  expandLabel
}: ExpanderRowProps): JSX.Element {
  const [open, setOpen] = useState(defaultExpanded)
  const titleId = useId()
  const panelId = useId()
  return (
    <div id={id} data-row={id} className="border-b border-edge-soft last:border-b-0">
      <div className="ui-row border-b-0">
        <span className="min-w-0 flex-1">
          <span id={titleId} className="ui-row-title block">
            {title}
          </span>
          {subtitle && <span className="ui-row-subtitle block">{subtitle}</span>}
        </span>
        {onEnabledChange && (
          <Switch aria-labelledby={titleId} checked={Boolean(enabled)} onChange={onEnabledChange} />
        )}
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-md"
          aria-label={expandLabel}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <PanDown size={16} className={cx('transition-transform duration-fast ease-ease', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div id={panelId} className="ui-expander-children" aria-disabled={onEnabledChange ? !enabled : undefined}>
          {children}
        </div>
      )}
    </div>
  )
}
