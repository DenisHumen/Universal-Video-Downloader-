/**
 * Read back what electron-builder put in each packed app under release/.
 *
 *   node scripts/check-package.mjs
 *
 * See package-contents.mjs for the rules. Beside fuses and ffmpeg: those ask
 * whether the binaries are right, this asks whether the app is all there and
 * nothing else is.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { packageProblems } from './package-contents.mjs'

// electron-builder's own dependency, so it is there wherever a package can be built.
const asar = createRequire(import.meta.url)('@electron/asar')

/** The app.asar inside a directory of release/<version>/, by the directory's name. */
function asarOf(dir) {
  if (/^(win|linux)(-[a-z0-9]+)?-unpacked$/.test(dir.name)) return join(dir.path, 'resources', 'app.asar')
  if (/^mac(-[a-z0-9]+)?$/.test(dir.name)) {
    const app = readdirSync(dir.path).find((name) => name.endsWith('.app'))
    return app && join(dir.path, app, 'Contents', 'Resources', 'app.asar')
  }
  return undefined
}

const found = []
for (const version of existsSync('release') ? readdirSync('release') : []) {
  const versionDir = join('release', version)
  if (!statSync(versionDir).isDirectory()) continue
  for (const name of readdirSync(versionDir)) {
    const path = join(versionDir, name)
    if (!statSync(path).isDirectory()) continue
    const file = asarOf({ name, path })
    if (file) found.push(file)
  }
}
if (found.length === 0) {
  console.error('✗ No packed app under release/ - run electron-builder (--dir is enough) first')
  process.exit(1)
}

let failed = false
for (const file of found) {
  const entries = asar
    .listPackage(file)
    .map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
    .filter((entry) => {
      // Directories come back too; the rules are about files.
      return !asar.statFile(file, entry.split('/').join(process.platform === 'win32' ? '\\' : '/'), false).files
    })
  const main = asar.extractFile(file, join('out', 'main', 'index.js')).toString('utf8')
  const size = statSync(file).size
  const problems = packageProblems(entries, main, size)
  console.log(`${problems.length === 0 ? '✓' : '✗'} ${file}: ${entries.length} files, ${(size / 1048576).toFixed(1)} MB`)
  for (const problem of problems) console.log(`    ${problem}`)
  if (problems.length > 0) failed = true
}
if (failed) process.exit(1)
