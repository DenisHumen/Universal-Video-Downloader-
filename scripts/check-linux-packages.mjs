/**
 * Open the built .deb and .rpm and check what a user would actually get.
 *
 * scripts/after-pack.mjs checks the inputs before any installer exists; this
 * checks the installers themselves, because the last three Linux bugs all lived
 * in the step between the two — electron-builder's own scripts, its desktop
 * entry writer and its icon lookup — and only showed up in a shipped package:
 *
 *  - the postinst must install the AppArmor profile, and the profile must
 *    attach to the executable the package really installs, or the app aborts
 *    on Ubuntu 24.04 before it shows a window;
 *  - hicolor must hold every size from 16 to 512, or launchers show a generic
 *    icon;
 *  - the desktop entry must pass desktop-file-validate and carry a
 *    StartupWMClass that matches the window, or the dock grows a second icon;
 *  - the ffmpeg must be one we may redistribute, with its README, its GPLv3
 *    text and THIRD_PARTY_NOTICES.txt installed beside the app - a repository
 *    that carries the package carries this obligation too.
 *
 * The rules live in scripts/linux-package.mjs and scripts/ffmpeg-pins.mjs, with
 * tests; this only gets the packages open. Linux only. Needs dpkg-deb, rpm and
 * desktop-file-validate, and uses apparmor_parser too when it is there, to
 * read the profile exactly the way the postinst will:
 *
 *   node scripts/check-linux-packages.mjs                 # release/<version>/*.{deb,rpm}
 *   node scripts/check-linux-packages.mjs some.deb x.rpm  # particular files
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { missingNotices, noticeProblems, thirdPartyProblems } from './ffmpeg-pins.mjs'
import {
  desktopEntryProblems,
  layoutProblems,
  packageLayout,
  profileProblem,
  rpmScriptlets,
  scriptProblems
} from './linux-package.mjs'

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })

function installed(tool) {
  try {
    execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Every file under a directory, relative to it. */
function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full, { throwIfNoEntry: false })?.isDirectory()) walk(root, full, out)
    else out.push(relative(root, full))
  }
  return out
}

function checkDeb(file) {
  const problems = []
  const section = run('dpkg-deb', ['-f', file, 'Section']).trim()
  if (section !== 'video') problems.push(`Section is "${section}", not "video"`)

  const work = mkdtempSync(join(tmpdir(), 'uvd-deb-'))
  try {
    const control = join(work, 'control')
    const root = join(work, 'root')
    run('dpkg-deb', ['-e', file, control])
    run('dpkg-deb', ['-x', file, root])
    const paths = walk(root)
    problems.push(...layoutProblems(paths))

    const { executable, product } = packageLayout(paths)
    if (!executable || !product) return problems
    const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
    problems.push(
      ...scriptProblems(read(join(control, 'postinst')), read(join(control, 'postrm')), executable)
    )

    const profilePath = join(root, 'opt', product, 'resources', 'apparmor-profile')
    if (existsSync(profilePath)) {
      const p = profileProblem(read(profilePath), `/opt/${product}/${executable}`, executable)
      if (p) problems.push(p)
      if (installed('apparmor_parser')) {
        try {
          run('apparmor_parser', ['--skip-kernel-load', '--debug', profilePath])
        } catch (err) {
          const why = String(err.stderr || err.message).trim()
          problems.push(`apparmor_parser rejects the profile: ${why}`)
        }
      }
    }

    const resources = join(root, 'opt', product, 'resources')
    const ffmpeg = join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg')
    if (existsSync(ffmpeg)) {
      const text = (p) => (existsSync(p) ? read(p) : null)
      problems.push(
        ...noticeProblems({
          name: 'ffmpeg',
          binary: readFileSync(ffmpeg),
          readme: text(`${ffmpeg}.README`),
          licence: text(`${ffmpeg}.LICENSE`)
        })
      )
      const notices = text(join(resources, 'THIRD_PARTY_NOTICES.txt'))
      problems.push(
        ...(notices == null
          ? ['resources/THIRD_PARTY_NOTICES.txt is missing']
          : thirdPartyProblems(notices))
      )
    } else problems.push('the bundled ffmpeg is missing')

    const desktopPath = join(root, 'usr', 'share', 'applications', `${executable}.desktop`)
    for (const p of desktopEntryProblems(read(desktopPath), executable))
      problems.push(`desktop entry: ${p}`)
    try {
      // Silent for a valid file. Hints are printed, but they do not fail it.
      const out = run('desktop-file-validate', [desktopPath]).trim()
      if (out) console.log(out)
    } catch (err) {
      problems.push(`desktop-file-validate: ${String(err.stdout || err.message).trim()}`)
    }
    return problems
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function checkRpm(file) {
  const problems = []
  const group = run('rpm', ['-qp', '--qf', '%{GROUP}', file]).trim()
  if (group !== 'Applications/Multimedia')
    problems.push(`Group is "${group}", not "Applications/Multimedia"`)

  const paths = run('rpm', ['-qlp', file]).split('\n').filter(Boolean)
  problems.push(...layoutProblems(paths))
  // Only listed: checkDeb reads the same files in full, and both packages are
  // made from one unpacked app.
  for (const n of missingNotices(paths)) problems.push(`${n} is not installed`)
  const { executable } = packageLayout(paths)
  if (executable) {
    const s = rpmScriptlets(run('rpm', ['-qp', '--scripts', file]))
    problems.push(...scriptProblems(s.postinstall ?? '', s.postuninstall ?? '', executable))
  }
  return problems
}

function findPackages() {
  if (!existsSync('release')) return []
  return readdirSync('release')
    .map((d) => join('release', d))
    .filter((d) => statSync(d).isDirectory())
    .flatMap((d) => readdirSync(d).map((f) => join(d, f)))
    .filter((f) => f.endsWith('.deb') || f.endsWith('.rpm'))
}

const files = process.argv.length > 2 ? process.argv.slice(2) : findPackages()
if (!files.some((f) => f.endsWith('.deb')) || !files.some((f) => f.endsWith('.rpm'))) {
  console.error(`✗ Expected a .deb and an .rpm, found: ${files.join(', ') || 'nothing'}`)
  process.exit(1)
}
for (const [tool, pkg] of [
  ['dpkg-deb', 'dpkg'],
  ['rpm', 'rpm'],
  ['desktop-file-validate', 'desktop-file-utils']
]) {
  if (!installed(tool)) {
    console.error(`✗ ${tool} is not installed (sudo apt-get install -y ${pkg})`)
    process.exit(1)
  }
}

let failed = false
for (const file of files) {
  const problems = file.endsWith('.deb') ? checkDeb(file) : checkRpm(file)
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${file}`)
  for (const p of problems) console.log(`    ${p}`)
  if (problems.length > 0) failed = true
}
if (failed) process.exit(1)
