import type { IconComponent, IconProps } from './icons'

/** sm 14 (dense rows, menus), md 16 (GNOME's symbolic grid), lg 24, xl 128 (status pages). */
export const ICON_SIZE = { sm: 14, md: 16, lg: 24, xl: 128 } as const

interface Props extends Omit<IconProps, 'size'> {
  icon: IconComponent
  size?: keyof typeof ICON_SIZE
  /** Give a meaningful icon a name; decorative ones (the default) are hidden from assistive tech. */
  label?: string
}

/** A symbolic icon at one of the sizes: `<Icon icon={Download} size="md" />`. */
export default function Icon({ icon: Glyph, size = 'md', label, ...rest }: Props): JSX.Element {
  return <Glyph size={ICON_SIZE[size]} aria-label={label} role={label ? 'img' : undefined} {...rest} />
}
