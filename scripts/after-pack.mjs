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
 * It also refuses an ffmpeg we may not hand out, or one without its notices:
 * the Linux build pinned for v3.20.0 was a nonfree one, and beside every
 * platform's binary sat a README for 6.1.1 naming the wrong source. Both rules
 * are in scripts/ffmpeg-pins.mjs.
 *
 * electron-builder calls this once per packed target, before the installer is
 * built, so throwing here stops the artifact from ever being published.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { archOf } from './check-ffmpeg-arch.mjs'
import { noticeProblems, thirdPartyProblems } from './ffmpeg-pins.mjs'
import { iconProblems, profileProblem } from './linux-package.mjs'

/** electron-builder's Arch enum, which arrives as a number. */
const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch } = context
  const target = ARCH_NAME[arch] ?? String(arch)

  // A universal binary is fat on purpose and contains both; nothing to check.
  if (target === 'universal') return

  const product = context.packager.appInfo.productFilename
  const resources =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${product}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources')
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static')
  const candidates =
    electronPlatformName === 'darwin'
      ? [join(unpacked, 'ffmpeg')]
      : [join(unpacked, 'ffmpeg.exe'), join(unpacked, 'ffmpeg')]

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

  checkNotices(binary, resources)
  if (electronPlatformName === 'linux') checkLinux(context)
}

/**
 * The ffmpeg has to be one FFmpeg's licence lets us pass on, with its README
 * and GPLv3 text beside it, and THIRD_PARTY_NOTICES.txt has to describe it.
 * README.md says the same but is not packaged, so these files are the only
 * notice a user ever receives.
 */
function checkNotices(binary, resources) {
  const name = basename(binary)
  const text = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
  const problems = noticeProblems({
    name,
    binary: readFileSync(binary),
    readme: text(`${binary}.README`),
    licence: text(`${binary}.LICENSE`)
  })
  const notices = text(join(resources, 'THIRD_PARTY_NOTICES.txt'))
  if (notices == null) problems.push('THIRD_PARTY_NOTICES.txt is missing from the resources')
  else problems.push(...thirdPartyProblems(notices))

  if (problems.length > 0) {
    throw new Error(
      `after-pack: this package may not be distributed as it stands:\n` +
        problems.map((p) => `    ${p}`).join('\n') +
        `\n  \`npm run fetch:ffmpeg\` installs the pinned ffmpeg with its README and licence;` +
        `\n  the pins and their sources are in scripts/ffmpeg-pins.mjs.`
    )
  }
  console.log(`  • ${name} is redistributable and its notices describe it`)
}

/**
 * The rest of what a Linux package needs in order to start and to have an icon,
 * both of which shipped broken without any build noticing (the header of
 * scripts/linux-package.mjs has the story).
 *
 * The profile is checked against the path this very build installs to, not a
 * copy of it: a profile for any other path attaches to nothing, and on Ubuntu
 * 24.04 the app aborts as if there were no profile at all.
 */
function checkLinux(context) {
  const { appOutDir, packager } = context
  const problems = []

  const iconsDir = join(packager.buildResourcesDir, 'icons')
  const icons = new Map(
    existsSync(iconsDir)
      ? readdirSync(iconsDir).map((name) => [name, readFileSync(join(iconsDir, name))])
      : []
  )
  for (const p of iconProblems(icons)) problems.push(`build/icons/${p}`)

  const executable = packager.executableName
  const installed = `/opt/${packager.appInfo.sanitizedProductName}/${executable}`
  const profilePath = join(appOutDir, 'resources', 'apparmor-profile')
  const profile = existsSync(profilePath)
    ? profileProblem(readFileSync(profilePath, 'utf8'), installed, executable)
    : 'resources/apparmor-profile is missing'
  if (profile) problems.push(profile)

  if (problems.length > 0) {
    throw new Error(
      `after-pack: this Linux package would not start or would have no icon:\n` +
        problems.map((p) => `    ${p}`).join('\n') +
        `\n  Icons come from \`npm run make:icons\` and are committed; the profile is` +
        `\n  build/linux/apparmor-profile, copied in by linux.extraResources.`
    )
  }
  console.log(`  • hicolor icons and the AppArmor profile for ${installed} are in place`)
}
