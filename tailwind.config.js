/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Monochrome "cobalt-like" dark palette
        ink: {
          950: '#08080a',
          900: '#0c0c0f',
          850: '#121216',
          800: '#17171c',
          750: '#1c1c22',
          700: '#222229',
          600: '#2b2b33',
          500: '#3a3a44'
        },
        cream: {
          DEFAULT: '#ededf2',
          dim: '#c9c9d2'
        }
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
        panel: '0 24px 70px -28px rgba(0, 0, 0, 0.85)',
        soft: '0 8px 30px -14px rgba(0, 0, 0, 0.7)'
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-up': 'fade-up 0.35s ease-out'
      }
    }
  },
  plugins: []
}
