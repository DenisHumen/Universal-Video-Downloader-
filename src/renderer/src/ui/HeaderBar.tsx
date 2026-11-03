import type { ReactNode } from 'react'
import { cx } from './cx'

interface Props {
  /** The pane's title, centred (GNOME `heading`). */
  title?: ReactNode
  /** Leading controls (a back button, the sidebar toggle, a search button). */
  start?: ReactNode
  /** Trailing controls (a menu, the caption buttons). */
  end?: ReactNode
  /** Draw the bottom shade: the content under the bar has scrolled. */
  shade?: boolean
  className?: string
  /** Hook for tests and the visual harness. */
  'data-uvd'?: string
}

/**
 * An AdwHeaderBar (D3): 46 px (D0), flat, its pane's colour, a centred
 * title and start/end slots. The whole bar is a window drag region; every
 * control inside is no-drag (the controls' own classes say so). The title
 * stays centred on the bar, not between the slots, as GTK centres it.
 */
export default function HeaderBar({ title, start, end, shade, className, ...rest }: Props): JSX.Element {
  return (
    <header
      className={cx('ui-headerbar drag-region', shade && 'ui-headerbar-shade', className)}
      data-uvd={rest['data-uvd']}
    >
      <div className="ui-headerbar-start">{start}</div>
      {title != null && (
        <h1 className="ui-headerbar-title" title={typeof title === 'string' ? title : undefined}>
          {title}
        </h1>
      )}
      <div className="ui-headerbar-end">{end}</div>
    </header>
  )
}
