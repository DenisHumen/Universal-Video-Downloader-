interface LogoProps {
  className?: string
}

/**
 * The Universal Video Downloader mark: an orbital ring (the "universal" web)
 * wrapping a download arrow whose head doubles as a play glyph.
 */
export default function Logo({ className }: LogoProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="uvd-grad" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9b7bff" />
          <stop offset="0.55" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="25"
        stroke="url(#uvd-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="118 39"
        opacity="0.95"
      />
      <path
        d="M32 14.5C33.66 14.5 35 15.84 35 17.5V30.5H40.7C42.33 30.5 43.2 32.42 42.12 33.64L33.42 43.5C32.66 44.36 31.34 44.36 30.58 43.5L21.88 33.64C20.8 32.42 21.67 30.5 23.3 30.5H29V17.5C29 15.84 30.34 14.5 32 14.5Z"
        fill="url(#uvd-grad)"
      />
    </svg>
  )
}
