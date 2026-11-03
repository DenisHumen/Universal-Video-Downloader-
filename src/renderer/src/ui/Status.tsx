import type { ReactNode } from 'react'

/** AdwBanner: a strip under a header bar with one optional button. */
export function Banner({ title, action, tone = 'accent' }: { title: ReactNode; action?: ReactNode; tone?: 'accent' | 'bad' }): JSX.Element {
  return (
    <div role="status" className={tone === 'bad' ? 'ui-banner ui-banner-bad' : 'ui-banner'}>
      <span className="min-w-0">{title}</span>
      {action}
    </div>
  )
}

/** An arc that turns (CSS keyframe; stops under reduced motion). Named for assistive tech when `label` is given. */
export function Spinner({ size = 16, label }: { size?: number; label?: string }): JSX.Element {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
