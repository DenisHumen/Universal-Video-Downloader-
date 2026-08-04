/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable so themes can be swapped at runtime
        // without rebuilding the stylesheet. See src/renderer/src/index.css.
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          750: 'rgb(var(--ink-750) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)'
        },
        cream: {
          DEFAULT: 'rgb(var(--cream) / <alpha-value>)',
          dim: 'rgb(var(--cream-dim) / <alpha-value>)'
        },
        /** Foreground tint for every translucent overlay: text-fg/40, bg-fg/[0.05]. */
        fg: 'rgb(var(--fg) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)'
        },
        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)'
      },
      fontFamily: {
        sans: [
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
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace'
        ]
      },
      borderRadius: {
        '4xl': '1.75rem'
      },
      boxShadow: {
        panel: '0 24px 70px -28px rgb(var(--shadow) / 0.85)',
        soft: '0 8px 30px -14px rgb(var(--shadow) / 0.7)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 10px 34px -14px rgb(var(--accent) / 0.5)'
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-up': 'fade-up 0.35s ease-out',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite'
      }
    }
  },
  plugins: []
}
