import { motion } from 'framer-motion'

export default function AuroraBackground(): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base-950">
      <motion.div
        className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(124,92,255,0.35), transparent 65%)' }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-32 top-10 h-[460px] w-[460px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.28), transparent 65%)' }}
        animate={{ x: [0, -50, 0], y: [0, 60, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-180px] left-1/3 h-[540px] w-[540px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(106,61,240,0.3), transparent 65%)' }}
        animate={{ x: [0, 40, 0], y: [0, -40, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_transparent_0%,_rgba(6,6,12,0.4)_60%,_rgba(6,6,12,0.85)_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")'
        }}
      />
    </div>
  )
}
