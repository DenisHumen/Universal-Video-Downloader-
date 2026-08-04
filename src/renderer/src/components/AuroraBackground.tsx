import { motion, useReducedMotion } from 'framer-motion'

/**
 * The cinematic backdrop: a dark gradient with two slow ambient light blobs
 * tinted by the active accent, plus a faint film grain.
 *
 * The blobs drift on long, offset cycles so the window never looks frozen but
 * nothing ever demands attention. They're transform/opacity only — the
 * compositor handles them without touching layout — and they hold still
 * entirely when the OS asks for reduced motion.
 */
export default function AuroraBackground(): JSX.Element {
  const reduced = useReducedMotion()

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(165deg, rgb(var(--ink-900)) 0%, rgb(var(--ink-950)) 55%, rgb(var(--ink-950)) 100%)'
        }}
      />

      <motion.div
        className="absolute -top-48 left-[12%] h-[620px] w-[720px] rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--accent) / 0.16), rgb(var(--accent) / 0.04) 45%, transparent 70%)'
        }}
        animate={reduced ? undefined : { x: [0, 70, -30, 0], y: [0, 40, 20, 0], opacity: [0.7, 1, 0.8, 0.7] }}
        transition={{ duration: 34, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-64 right-[8%] h-[560px] w-[640px] rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--fg) / 0.05), rgb(var(--accent) / 0.05) 50%, transparent 72%)'
        }}
        animate={reduced ? undefined : { x: [0, -60, 25, 0], y: [0, -35, -15, 0], opacity: [0.6, 0.9, 0.7, 0.6] }}
        transition={{ duration: 42, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Vignette: pulls the eye to the middle of the window. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 15%, transparent 25%, rgb(var(--ink-950) / 0.7) 100%)'
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
