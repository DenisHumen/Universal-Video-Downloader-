/**
 * What app.asar has to hold, and what it must not.
 *
 * The rules, apart from scripts/check-package.mjs so they can be tested without
 * a packed app. `electron-builder.yml` only excludes what it is told to, and it
 * takes everything else: the visual test baselines were 7.5 MB of every install
 * for as long as they existed, and nothing looked.
 */

/** Every path the app opens at run time, and the dependencies main loads when it needs them. */
export const REQUIRED = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.js',
  'out/preload/site.js',
  'out/renderer/index.html',
  'resources/icons/app.png',
  'resources/icons/tray.png',
  'resources/icons/tray-dark.png',
  'node_modules/electron-updater/package.json',
  'node_modules/node-smb2/package.json',
  'node_modules/ffmpeg-static/index.js',
  // Loaded from inside by moment-timezone, by way of node-smb2.
  'node_modules/moment/moment.js',
  'node_modules/moment-timezone/data/packed/latest.json'
]

const FORBIDDEN = [
  [/^(tests?|src|scripts|docs|design-system|packaging|assets|build|release)\//, 'a repository folder'],
  [/^[^/]*\.(md|ya?ml|mjs|ts)$/, 'a repository file'],
  [/^\.[^/]+$/, 'a repository dotfile'],
  [/\.test\.[cm]?[jt]sx?$/, 'a test'],
  [/^out\/.*\.map$/, 'a source map'],
  [/^node_modules\/(.*\/)?(react|react-dom|vitest|vite|typescript|electron|electron-builder|eslint|tailwindcss|@testing-library)\//, 'a development dependency']
]

/**
 * A sentence from each half of what main says in Russian: its own small
 * dictionary (locale.ts) and the interface's, which it imports from the renderer
 * for what it says with no window open (words.ts).
 */
const MAIN_MUST_SAY = [
  ['Показать в папке', "main's own dictionary"],
  ['Не удалось использовать этот файл', "the interface's dictionary"]
]

/** Only React's runtime has these. The dictionaries are plain data and must stay that way. */
const REACT_RUNTIME = /react\.(transitional\.)?element|__SECRET_INTERNALS_DO_NOT_USE|__CLIENT_INTERNALS_DO_NOT_USE/

/** Today's size plus a little: 10 MB. Growing past this is worth a look and a change here. */
export const ASAR_BUDGET = 14 * 1024 * 1024

/**
 * @param {string[]} entries the archive's files, with forward slashes and no leading slash
 * @param {string} mainBundle the text of out/main/index.js
 * @param {number} size the archive's size in bytes
 * @returns {string[]} what is wrong, in words; empty when nothing is
 */
export function packageProblems(entries, mainBundle, size) {
  const problems = []
  const present = new Set(entries)
  for (const path of REQUIRED) {
    if (!present.has(path)) problems.push(`${path} is missing`)
  }
  for (const [pattern, what] of FORBIDDEN) {
    const found = entries.filter((path) => pattern.test(path))
    if (found.length) problems.push(`${found.length} × ${what}, such as ${found[0]}`)
  }
  for (const [text, where] of MAIN_MUST_SAY) {
    if (!mainBundle.includes(text)) problems.push(`the main bundle does not have ${where} (looked for "${text}")`)
  }
  if (REACT_RUNTIME.test(mainBundle)) problems.push('the main bundle has React in it')
  if (size > ASAR_BUDGET) {
    problems.push(`app.asar is ${(size / 1048576).toFixed(1)} MB, over the budget of ${ASAR_BUDGET / 1048576} MB`)
  }
  return problems
}
