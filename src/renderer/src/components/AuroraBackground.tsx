import { motion } from 'framer-motion'

/**
 * A calm backdrop in the spirit of cobalt.tools: the theme's darkest surface
 * with a single very subtle drifting highlight (tinted with the accent) and a
 * faint film grain. Everything is driven by CSS variables, so it follows the
 * active theme without a re-render.
 */
export default function AuroraBackground(): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <motion.div
        className="absolute -top-40 left-1/2 h-[560px] w-[760px] -translate-x-1/2 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--accent) / 0.10), rgb(var(--fg) / 0.03) 45%, transparent 70%)'
        }}
        animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.06, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at top, transparent 30%, rgb(var(--ink-950) / 0.55) 100%)'
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: 'var(--grain)',
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")'
        }}
      />
    </div>
  )
}
