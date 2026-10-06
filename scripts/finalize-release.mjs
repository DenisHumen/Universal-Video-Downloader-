/**
 * The last check before a draft release goes public, run by the finalize job
 * in .github/workflows/release.yml once every runner has uploaded.
 *
 * Given the release's installers and update files (downloaded from the draft)
 * and the latest-mac.yml each Mac runner kept for itself, it:
 *
 *  - merges the two latest-mac.yml into one that lists both architectures;
 *  - refuses if any installer or update file the release needs is missing;
 *  - reads every installer, and refuses if an update file gives one a size or
 *    sha512 it does not have — every installed copy would download it and
 *    then throw it away;
 *  - writes SHA256SUMS for packagers and for anyone checking a download.
 *
 * It writes latest-mac.yml and SHA256SUMS into the assets folder and leaves
 * uploading and publishing to the workflow. The rules are in
 * scripts/release-assets.mjs, with tests.
 *
 *   node scripts/finalize-release.mjs --version=3.20.0 --assets=assets --mac=mac-update-info
 *
 * `--mac` holds one folder per runner, as actions/download-artifact lays out
 * the artifacts the build job names mac-x64 and mac-arm64.
 */
import { createHash } from 'crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  UPDATE_INFO,
  installersIn,
  mergeMacUpdateInfo,
  missingAssets,
  releaseBinaries,
  sha256sums,
  updateInfoProblems
} from './release-assets.mjs'

/** Size, hex SHA-256 and base64 SHA-512 of a file, in one read. */
async function digest(path) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk)
    sha512.update(chunk)
    size += chunk.length
  }
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') }
}

/** The latest-mac.yml one Mac runner kept, by its artifact name. */
function runnerCopy(macDir, runner) {
  const path = join(macDir, runner, 'latest-mac.yml')
  if (!existsSync(path)) throw new Error(`${runner}/latest-mac.yml is missing: that runner kept no copy`)
  return readFileSync(path, 'utf8')
}

/**
 * Merge, check and checksum a release laid out on disk. Resolves with the
 * names SHA256SUMS lists and any warnings; rejects, naming every problem at
 * once, if the release is not fit to publish.
 */
export async function finalizeRelease({ version, assetsDir, macDir }) {
  const merged = mergeMacUpdateInfo(runnerCopy(macDir, 'mac-x64'), runnerCopy(macDir, 'mac-arm64'))
  writeFileSync(join(assetsDir, 'latest-mac.yml'), merged)

  const names = readdirSync(assetsDir)
  const missing = missingAssets(version, names)
  if (missing.length > 0) {
    throw new Error(`not on the release: ${missing.join(', ')}`)
  }

  const installers = installersIn(names).sort()
  const expected = new Set(releaseBinaries(version))
  const warnings = installers
    .filter((n) => !expected.has(n))
    .map((n) => `${n} is on the release but not in scripts/release-assets.mjs or the notes`)

  const actual = new Map()
  for (const name of installers) actual.set(name, await digest(join(assetsDir, name)))

  const problems = UPDATE_INFO.flatMap((name) =>
    updateInfoProblems(name, readFileSync(join(assetsDir, name), 'utf8'), version, actual)
  )
  if (problems.length > 0) throw new Error(problems.join('\n'))

  writeFileSync(
    join(assetsDir, 'SHA256SUMS'),
    sha256sums(installers.map((name) => ({ name, sha256: actual.get(name).sha256 })))
  )
  return { installers, warnings }
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main() {
  const version = arg('version')
  const assets = arg('assets')
  const mac = arg('mac')
  if (!version || !assets || !mac) {
    throw new Error('usage: finalize-release.mjs --version=X.Y.Z --assets=<dir> --mac=<dir>')
  }
  const { installers, warnings } = await finalizeRelease({
    version: version.replace(/^v/, ''),
    assetsDir: resolve(assets),
    macDir: resolve(mac)
  })
  for (const w of warnings) console.log(`::warning::${w}`)
  console.log('latest-mac.yml merged; every update file matches the release.')
  console.log(`SHA256SUMS lists ${installers.length} files:`)
  for (const n of installers) console.log(`  ${n}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // One annotation per problem, so each shows on the run's summary page.
    for (const line of err.message.split('\n')) console.error(`::error::${line}`)
    process.exit(1)
  })
}
