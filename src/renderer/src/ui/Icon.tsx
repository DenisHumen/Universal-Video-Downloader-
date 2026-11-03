import type { IconComponent, IconProps } from './icons'
import { ICON_STROKE } from './icons'

/** sm 14 (dense rows, menus), md 16 (controls), lg 24 (empty states, hero). */
export const ICON_SIZE = { sm: 14, md: 16, lg: 24 } as const

interface Props extends Omit<IconProps, 'size' | 'ref'> {
  icon: IconComponent
  size?: keyof typeof ICON_SIZE
  /** Give a meaningful icon a name; decorative ones (the default) are hidden from assistive tech. */
  label?: string
}

/**
 * An icon at one of the three sizes, stroke 1.75 (plan 3.2).
 * `<Icon icon={Download} size="md" />`.
 */
export default function Icon({ icon: Glyph, size = 'md', label, ...rest }: Props): JSX.Element {
  return (
    <Glyph
      size={ICON_SIZE[size]}
      strokeWidth={ICON_STROKE}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  )
}
