import { motion } from 'framer-motion'

/**
 * A calm, monochrome backdrop in the spirit of cobalt.tools: near-black with a
 * single very subtle drifting highlight and a faint film grain.
 */
export default function AuroraBackground(): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <motion.div
        className="absolute -top-40 left-1/2 h-[560px] w-[760px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)' }}
        animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.06, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_transparent_30%,_rgba(0,0,0,0.55)_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")'
        }}
      />
    </div>
  )
}
