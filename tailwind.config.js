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
        // Floating planes: menus, popovers, dialogs. White in Day, a step
        // above a field in Night.
        float: 'rgb(var(--surface-3) / <alpha-value>)',
        // GNOME planes (A1): cards and boxed lists, the app sidebar, Settings' panel list.
        card: 'rgb(var(--card) / <alpha-value>)',
        sidebar: {
          DEFAULT: 'rgb(var(--sidebar) / <alpha-value>)',
          2: 'rgb(var(--sidebar-2) / <alpha-value>)'
        },
        // The text colour as a fill: bg-fill/10 rest, /15 hover, /30 active (D0).
        fill: 'rgb(var(--fill) / <alpha-value>)',
        destructive: 'rgb(var(--destructive) / <alpha-value>)',
        edge: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          soft: 'rgb(var(--line-soft) / <alpha-value>)',
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
        bad: {
          DEFAULT: 'rgb(var(--bad) / <alpha-value>)',
          // Label on a solid `bad` fill. White on Night's pink is 2.69:1, so
          // unlike accent-fg this one flips: near-black in Night, white in Day.
          fg: 'rgb(var(--bad-fg) / <alpha-value>)'
        }
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
      /*
       * The type scale (4.0, plan 2.5). Seven steps and nothing between them;
       * `text-[Npx]` is refused by stylesheet.test.ts. The four UI sizes
       * carry no line-height of their own and keep the body's 1.5, so a
       * label moved onto a token does not shift its row.
       */
      fontSize: {
        hero: ['28px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        title: ['22px', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
        section: ['16px', { lineHeight: '1.35' }],
        body: '14px',
        control: '13px',
        meta: '12px',
        caption: '11px'
      },
      borderRadius: {
        1: 'var(--r-1)',
        2: 'var(--r-2)',
        3: 'var(--r-3)',
        4: 'var(--r-4)',
        pill: 'var(--r-pill)'
      },
      // Status fills sit at 12% — enough to read as a tinted plane, light
      // enough that the status text on top keeps its verified contrast.
      opacity: {
        12: '0.12'
      },
      transitionTimingFunction: {
        // Decelerate-emphasised: off the mark instantly, lands soft. The app's
        // one curve — nothing eases on anything else.
        ease: 'var(--ease)',
        spring: 'var(--ease-spring)'
      },
      // The motion tokens in index.css; Tailwind only points at them.
      transitionDuration: {
        press: 'var(--t-press)',
        fast: 'var(--t-fast)',
        base: 'var(--t-base)',
        slow: 'var(--t-slow)'
      },
      keyframes: {
        'idle-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' }
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        // Opacity only: see App.tsx for why the view host never transforms.
        'view-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      },
      animation: {
        'idle-pulse': 'idle-pulse 1.6s var(--ease) infinite',
        rise: 'rise var(--t-base) var(--ease)',
        'view-in': 'view-in var(--t-view) var(--ease)'
      }
    }
  },
  plugins: []
}
