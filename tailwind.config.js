/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour resolves through a CSS variable so a theme swap is one
        // attribute on <html> — no rebuild, no flash. See index.css.
        //
        // Planes, darkest-to-lightest in Night and the reverse in Day:
        // canvas (the window) < raise (a block) < sink (a field inside it).
        canvas: 'rgb(var(--bg) / <alpha-value>)',
        raise: 'rgb(var(--surface) / <alpha-value>)',
        sink: 'rgb(var(--surface-2) / <alpha-value>)',
        edge: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)'
        },
        // Three text tiers, all verified ≥4.5:1 on every plane by
        // scripts/check-contrast.mjs. Never write text in a plane colour.
        ink: {
          DEFAULT: 'rgb(var(--text) / <alpha-value>)',
          2: 'rgb(var(--text-2) / <alpha-value>)',
          3: 'rgb(var(--text-3) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          // Label on an accent fill.
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          // Accent-coloured *text* on a plane — a lighter/darker cut of the
          // same hue, because the fill colour alone never clears 4.5:1.
          ink: 'rgb(var(--accent-ink) / <alpha-value>)'
        },
        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)'
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono Variable',
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace'
        ]
      },
      borderRadius: {
        1: 'var(--r-1)',
        2: 'var(--r-2)',
        3: 'var(--r-3)'
      },
      // Status fills sit at 12% — enough to read as a tinted plane, light
      // enough that the status text on top keeps its verified contrast.
      opacity: {
        12: '0.12'
      },
      transitionTimingFunction: {
        // Decelerate-emphasised: off the mark instantly, lands soft. The app's
        // one curve — nothing eases on anything else.
        ease: 'cubic-bezier(0.2, 0, 0, 1)'
      },
      transitionDuration: {
        fast: '160ms',
        base: '240ms',
        slow: '320ms'
      },
      keyframes: {
        'idle-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' }
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'idle-pulse': 'idle-pulse 1.6s cubic-bezier(0.2, 0, 0, 1) infinite',
        rise: 'rise 240ms cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: []
}
