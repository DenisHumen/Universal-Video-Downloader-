/**
 * What a release has to hold before it may go public, and the two files the
 * release workflow writes itself: the merged latest-mac.yml and SHA256SUMS.
 *
 * Every runner used to publish on its own, and each way that went wrong was
 * silent:
 *
 *  - electron-builder created the release as public the moment the first
 *    runner finished. Until the last one was done, the newest release lacked
 *    latest.yml (an update error on every check from Windows) or the very file
 *    a Mac or Linux user had just been sent to download.
 *  - A runner that finished more than two hours after that found a release
 *    electron-builder refuses to touch, logged "skipped publishing" and went
 *    green with nothing uploaded.
 *  - Both Mac runners upload a latest-mac.yml of the same name, and the one
 *    that finishes last replaces the other's: v3.20.0's lists the Intel files
 *    only.
 *
 * The runners now upload to a draft, and the finalize job in
 * .github/workflows/release.yml publishes it only once
 * scripts/finalize-release.mjs has found all of this on it.
 *
 * No YAML library on purpose: the finalize job runs without `npm ci`, and the
 * update files are electron-builder's own output in one fixed shape.
 */

/** The file-name prefix every installer shares: productName with dashes for spaces. */
export const PRODUCT = 'Universal-Video-Downloader'

/** The update metadata electron-updater reads on Windows, macOS and Linux. */
export const UPDATE_INFO = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']

/** What counts as an installer: each of these goes into SHA256SUMS. */
export const INSTALLER_EXTENSIONS = ['.exe', '.dmg', '.zip', '.AppImage', '.deb', '.rpm']

/**
 * Every installer a release must carry — the ones the release notes link to.
 * The names follow the artifactName patterns in electron-builder.yml (a test
 * holds the two together). Blockmaps are left out: they only make updates
 * smaller, and GitHub renames the zip ones, so their names are not ours to
 * promise.
 */
export function releaseBinaries(version) {
  const p = `${PRODUCT}-${version}`
  return [
    `${p}-windows-x64-setup.exe`,
    `${p}-mac-arm64.dmg`,
    `${p}-mac-arm64.zip`,
    `${p}-mac-x64.dmg`,
    `${p}-mac-x64.zip`,
    `${p}-linux-x86_64.AppImage`,
    `${p}-linux-amd64.deb`,
    `${p}-linux-x86_64.rpm`
  ]
}

/** The names among `names` that are installers. */
export function installersIn(names) {
  return names.filter((n) => INSTALLER_EXTENSIONS.some((ext) => n.endsWith(ext)))
}

/** What a release must hold but `present` (a list of asset names) does not. */
export function missingAssets(version, present) {
  const have = new Set(present)
  return [...releaseBinaries(version), ...UPDATE_INFO].filter((n) => !have.has(n))
}

/** A YAML scalar as js-yaml writes one: plain, 'single' or "double" quoted. */
function scalar(raw) {
  const s = raw.trim()
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) throw new Error(`unterminated string: ${s}`)
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (s.startsWith('"')) return JSON.parse(s)
  return s
}

const TOP_KEY = /^([A-Za-z_][\w-]*):(?: (.*))?$/
const ITEM = /^ *- ([A-Za-z_][\w-]*):(?: (.*))?$/
const FIELD = /^ +([A-Za-z_][\w-]*):(?: (.*))?$/

/**
 * An update file split into its top-level keys, each with the lines it spans.
 * Throws on anything outside the one shape electron-builder writes (block
 * style, a single `files:` list, no folded lines), rather than half-reading it.
 */
function readUpdateInfo(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const fields = {}
  const files = []
  let filesAt = -1
  let filesEnd = -1
  let section = ''
  lines.forEach((line, i) => {
    if (line.trim() === '') return
    const top = TOP_KEY.exec(line)
    if (top) {
      if (section === 'files') filesEnd = i
      section = top[1]
      if (section in fields || (section === 'files' && filesAt >= 0)) {
        throw new Error(`${section} appears twice`)
      }
      if (section === 'files') {
        if (top[2]) throw new Error('files is not a list')
        filesAt = i
      } else {
        fields[section] = scalar(top[2] ?? '')
      }
      return
    }
    if (section !== 'files') throw new Error(`unexpected line ${i + 1}: ${line}`)
    const item = ITEM.exec(line)
    if (item) {
      files.push({ [item[1]]: scalar(item[2] ?? '') })
      return
    }
    const field = FIELD.exec(line)
    if (field && files.length > 0) {
      files[files.length - 1][field[1]] = scalar(field[2] ?? '')
      return
    }
    throw new Error(`unexpected line ${i + 1}: ${line}`)
  })
  if (section === 'files') filesEnd = lines.length
  // Trailing blank lines belong to nothing; keep them out of the files block.
  while (filesEnd > filesAt + 1 && lines[filesEnd - 1].trim() === '') filesEnd--
  for (const f of files) {
    if (!f.url) throw new Error('a file entry has no url')
  }
  return { lines, fields, files, filesAt, filesEnd }
}

/**
 * The top-level fields of an electron-builder update file (latest*.yml), and
 * its `files` list, one record of strings per entry.
 */
export function parseUpdateInfo(text) {
  const { fields, files } = readUpdateInfo(text)
  return { fields, files }
}

/**
 * One latest-mac.yml from the two the Mac runners wrote.
 *
 * The Intel file is kept as it is — its version, releaseDate and top-level
 * path/sha512, which only an electron-updater older than files lists reads —
 * and the Apple silicon entries are added to its `files`. MacUpdater picks
 * between them by the "arm64" in each url, so each Mac still gets its own zip.
 * Inputs the wrong way round, or a runner that built the other architecture
 * (the Intel image once came off the arm64 runner), are refused here.
 */
export function mergeMacUpdateInfo(x64Text, arm64Text) {
  const x64 = readUpdateInfo(x64Text)
  const arm = readUpdateInfo(arm64Text)
  if (!x64.fields.version) throw new Error('the x64 latest-mac.yml has no version')
  if (x64.fields.version !== arm.fields.version) {
    const [x, a] = [x64.fields.version, arm.fields.version || 'none']
    throw new Error(`the Mac runners built different versions: x64 ${x}, arm64 ${a}`)
  }
  if (x64.files.length === 0) throw new Error('the x64 latest-mac.yml lists no files')
  if (arm.files.length === 0) throw new Error('the arm64 latest-mac.yml lists no files')
  for (const f of x64.files) {
    if (f.url.includes('arm64')) {
      throw new Error(`the x64 latest-mac.yml lists ${f.url}, an Apple silicon file`)
    }
  }
  for (const f of arm.files) {
    if (!f.url.includes('arm64')) {
      throw new Error(`the arm64 latest-mac.yml lists ${f.url}, which is not an Apple silicon file`)
    }
  }

  const added = arm.lines.slice(arm.filesAt + 1, arm.filesEnd).filter((l) => l.trim() !== '')
  const lines = [...x64.lines]
  lines.splice(x64.filesEnd, 0, ...added)
  const merged = lines.join('\n')

  // Read back what was written, so a splice in the wrong place cannot ship.
  const check = readUpdateInfo(merged)
  if (check.files.length !== x64.files.length + arm.files.length) {
    throw new Error("the merged latest-mac.yml does not list both runners' files")
  }
  return merged
}

/**
 * Why an update file does not describe the release it sits on. `actual` maps
 * an asset name to its real size and base64 sha512, the two things
 * electron-updater checks a download against; a mismatch here is an update
 * that every installed copy would download and then reject.
 */
export function updateInfoProblems(name, text, version, actual) {
  let info
  try {
    info = readUpdateInfo(text)
  } catch (err) {
    return [`${name} cannot be read: ${err.message}`]
  }
  const problems = []
  if (info.fields.version !== version) {
    problems.push(`${name} is for ${info.fields.version || 'no version'}, not ${version}`)
  }
  if (info.files.length === 0) problems.push(`${name} lists no files`)
  for (const f of info.files) {
    const real = actual.get(f.url)
    if (!real) {
      problems.push(`${name} lists ${f.url}, which is not on the release`)
      continue
    }
    if (Number(f.size) !== real.size) {
      problems.push(`${name} gives ${f.url} as ${f.size} bytes; the release has ${real.size}`)
    }
    if (f.sha512 !== real.sha512) {
      problems.push(`${name} has a sha512 for ${f.url} that is not the file on the release`)
    }
  }
  if (info.fields.path && !info.files.some((f) => f.url === info.fields.path)) {
    problems.push(`${name} points path at ${info.fields.path}, which is not among its files`)
  }
  return problems
}

/**
 * SHA256SUMS in the format `sha256sum --check` reads: the hex digest, two
 * spaces, the name — sorted, one per line. sha256sum escapes a name with a
 * backslash or a newline in it, which ours never have; refuse rather than
 * write a line it would misread.
 */
export function sha256sums(entries) {
  return (
    [...entries]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, sha256 }) => {
        if (/[\\\n\r]/.test(name)) throw new Error(`cannot list ${JSON.stringify(name)}`)
        if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a SHA-256: ${sha256}`)
        return `${sha256}  ${name}`
      })
      .join('\n') + '\n'
  )
}
