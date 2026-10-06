/**
 * Read Electron's fuses back out of the apps electron-builder finished.
 *
 * scripts/after-pack.mjs flips them in each packed app and checks its own
 * work, but electron-builder goes on changing the app after the hook returns:
 * on Windows it rewrites the executable's resources with rcedit, and outside
 * CI, with a signing certificate, it may put back an executable it cached from
 * an earlier build. This reads the binary the installers are made from.
 *
 *   node scripts/check-fuses.mjs                # every packed app under release/
 *   node scripts/check-fuses.mjs <binary> …     # particular Electron binaries
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fuseBinaryPath, fuseProblems, fuseStates, fuseWires } from './electron-fuses.mjs'

const builderYml = readFileSync('electron-builder.yml', 'utf8')
const productFilename = /^productName:\s*(.+?)\s*$/m.exec(builderYml)?.[1]
// linux.executableName is not set, so electron-builder names it after package.json.
const executableName = JSON.parse(readFileSync('package.json', 'utf8')).name

/** The platform electron-builder packed into a directory of release/<version>/, by its name. */
function platformOf(dir) {
  if (/^win(-[a-z0-9]+)?-unpacked$/.test(dir)) return 'win32'
  if (/^linux(-[a-z0-9]+)?-unpacked$/.test(dir)) return 'linux'
  if (/^mac(-[a-z0-9]+)?$/.test(dir)) return 'darwin'
  return null
}

function findPackedApps() {
  if (!existsSync('release')) return []
  const found = []
  for (const version of readdirSync('release')) {
    const versionDir = join('release', version)
    if (!statSync(versionDir).isDirectory()) continue
    for (const dir of readdirSync(versionDir)) {
      const platform = platformOf(dir)
      if (!platform || !statSync(join(versionDir, dir)).isDirectory()) continue
      found.push(fuseBinaryPath(platform, join(versionDir, dir), { productFilename, executableName }))
    }
  }
  return found
}

const files = process.argv.length > 2 ? process.argv.slice(2) : findPackedApps()
if (files.length === 0) {
  console.error('✗ No packed app under release/ - run electron-builder (--dir is enough) first')
  process.exit(1)
}

let failed = false
for (const file of files) {
  const buf = existsSync(file) ? readFileSync(file) : null
  const problems = buf ? fuseProblems(buf) : ['there is no such file']
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${file}`)
  if (buf) {
    for (const wire of fuseWires(buf)) {
      const states = Object.entries(fuseStates(buf, wire))
      console.log(`    ${states.map(([name, state]) => `${name} ${state}`).join(', ')}`)
    }
  }
  for (const p of problems) console.log(`    ${p}`)
  if (problems.length > 0) failed = true
}
if (failed) process.exit(1)
