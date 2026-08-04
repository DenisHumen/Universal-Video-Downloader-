interface LogoProps {
  className?: string
}

/**
 * The mark: three bars converging onto a baseline — a stream narrowing into a
 * file on disk.
 *
 * Pure geometry on the 24px grid, no gradient and no stroke, so it stays legible
 * at 16px in the title bar and inherits whatever colour it sits in. The previous
 * mark was a gradient-filled orbital ring, which needed its own light source to
 * make sense; this system doesn't have one.
 */
export default function Logo({ className }: LogoProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="3.2" rx="1.6" />
      <rect x="6.4" y="9.4" width="11.2" height="3.2" rx="1.6" />
      <rect x="9.8" y="15.8" width="4.4" height="3.2" rx="1.6" />
      <rect x="3" y="21.4" width="18" height="1.6" rx="0.8" opacity="0.45" />
    </svg>
  )
}
