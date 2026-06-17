/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark "Midnight Aurora" palette
        base: {
          950: '#06060c',
          900: '#0a0a14',
          850: '#0e0e1c',
          800: '#121225',
          700: '#1a1a30',
          600: '#24243f',
          500: '#32324f'
        },
        accent: {
          DEFAULT: '#7c5cff',
          50: '#f1edff',
          100: '#e3d9ff',
          200: '#c8b4ff',
          300: '#ab8cff',
          400: '#8f6cff',
          500: '#7c5cff',
          600: '#6a3df0',
          700: '#5a2fd0',
          800: '#4a26a8',
          900: '#3a1f80'
        },
        teal: {
          DEFAULT: '#22d3ee',
          400: '#34e0f5',
          500: '#22d3ee',
          600: '#0fb6d0'
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
        ]
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(124, 92, 255, 0.55)',
        'glow-teal': '0 0 40px -12px rgba(34, 211, 238, 0.5)',
        card: '0 12px 40px -12px rgba(0, 0, 0, 0.6)'
      },
      backgroundImage: {
        'aurora':
          'radial-gradient(60% 80% at 20% 10%, rgba(124,92,255,0.18) 0%, transparent 60%), radial-gradient(50% 70% at 90% 20%, rgba(34,211,238,0.14) 0%, transparent 55%), radial-gradient(60% 90% at 60% 100%, rgba(124,92,255,0.12) 0%, transparent 60%)'
      },
      keyframes: {
        'aurora-shift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(0,-2%,0) scale(1.05)' }
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'aurora-shift': 'aurora-shift 18s ease-in-out infinite',
        shimmer: 'shimmer 1.8s infinite'
      }
    }
  },
  plugins: []
}
