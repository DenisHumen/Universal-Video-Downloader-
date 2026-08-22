/**
 * Refuse to ship an app whose bundled ffmpeg cannot run on the machine it is
 * built for.
 *
 * `check-ffmpeg-arch.mjs` looks at `node_modules`, which answers "is the copy on
 * this runner right for this runner" — and that is not the question. The
 * question is what ended up inside each packaged target, and the two came apart
 * badly: `mac.target[].arch` listed both arm64 and x64, so the Apple silicon
 * runner produced an Intel disk image as well, fourteen seconds after the
 * arm64 one, out of the same `node_modules`. The Intel image therefore carried
 * an Apple silicon ffmpeg. The Intel runner that was supposed to build it never
 * got allocated at all, and nothing noticed, because the guard had already
 * passed against a `node_modules` that was correct for the host.
 *
 * On an Intel Mac that fails as `spawn … Bad CPU type in executable` on every
 * merge, trim and convert — which is essentially every download, since the
 * default format is separate video and audio streams that have to be joined.
 *
 * electron-builder calls this once per packed target, before the installer is
 * built, so throwing here stops the artifact from ever being published.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { archOf } from './check-ffmpeg-arch.mjs'

/** electron-builder's Arch enum, which arrives as a number. */
const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context
  const target = ARCH_NAME[arch] ?? String(arch)

  // A universal binary is fat on purpose and contains both; nothing to check.
  if (target === 'universal') return

  const product = context.packager.appInfo.productFilename
  const unpacked = join('app.asar.unpacked', 'node_modules', 'ffmpeg-static')
  const candidates =
    electronPlatformName === 'darwin'
      ? [join(appOutDir, `${product}.app`, 'Contents', 'Resources', unpacked, 'ffmpeg')]
      : [
          join(appOutDir, 'resources', unpacked, 'ffmpeg.exe'),
          join(appOutDir, 'resources', unpacked, 'ffmpeg')
        ]

  const binary = candidates.find((p) => existsSync(p))
  if (!binary) {
    throw new Error(
      `after-pack: no bundled ffmpeg found for ${electronPlatformName}/${target}.\n` +
        `  Looked in:\n${candidates.map((p) => `    ${p}`).join('\n')}\n` +
        `  Without it every merge, trim and convert fails at runtime, so this is\n` +
        `  not something to package around.`
    )
  }

  const { arches, format } = archOf(binary)
  if (!arches.includes(target)) {
    throw new Error(
      `after-pack: the ffmpeg inside the ${electronPlatformName}/${target} build is ` +
        `${arches.join(', ') || 'unrecognised'} (${format}).\n` +
        `  It cannot run on the machines this package is for.\n` +
        `  ffmpeg-static downloads one binary for whichever machine ran npm install,\n` +
        `  and electron-builder copies that same node_modules into every target — so\n` +
        `  each architecture has to be built on a runner of its own.\n`
    )
  }

  console.log(`  • bundled ffmpeg is ${arches.join(', ')} — correct for ${target}`)
}
