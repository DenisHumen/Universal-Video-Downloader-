/**
 * Assemble the website (website/) into a folder GitHub Pages can serve.
 *
 *   node scripts/build-website.mjs --out=site
 *
 * Adds what the page points at but does not keep itself: the screenshots and the
 * tours in both themes (docs/), the logo and icon, the app's own fonts, and
 * releases.json, every published version and its files, so a visit asks GitHub
 * for nothing. With GH_TOKEN (CI) the list comes from the API with the token;
 * without it, unauthenticated, which is fine for an occasional local build.
 * `--no-releases` skips the list for a quick look; the page then asks the API.
 *
 * Files already in the folder are left alone: the release job builds the signed
 * dnf repository into the same folder first.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const OUT = resolve(root, arg('out', 'site'))
const REPO = process.env.GH_REPO || 'DenisHumen/Universal-Video-Downloader'

mkdirSync(OUT, { recursive: true })
cpSync(join(root, 'website'), OUT, { recursive: true })

const copyDir = (from, to, keep = () => true) => {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    if (name.endsWith('.png') && keep(name)) copyFileSync(join(from, name), join(to, name))
  }
}
copyDir(join(root, 'docs/screenshots'), join(OUT, 'media/shots/en'))
copyDir(join(root, 'docs/screenshots/ru'), join(OUT, 'media/shots/ru'))
copyDir(join(root, 'docs/screenshots/day'), join(OUT, 'media/shots/day'))
copyDir(join(root, 'docs/screenshots/ru-day'), join(OUT, 'media/shots/ru-day'))
for (const tour of ['tour.mp4', 'tour-day.mp4']) copyFileSync(join(root, 'docs/assets', tour), join(OUT, 'media', tour))

copyFileSync(join(root, 'assets/logo.svg'), join(OUT, 'logo.svg'))
copyFileSync(join(root, 'build/icons/256x256.png'), join(OUT, 'icon-256.png'))
mkdirSync(join(OUT, 'fonts'), { recursive: true })
for (const font of ['UbuntuSans-wdth-wght.ttf', 'UbuntuSansMono-wght.ttf', 'UFL-1.0.txt']) {
  copyFileSync(join(root, 'src/renderer/src/assets/fonts', font), join(OUT, 'fonts', font))
}
// GitHub Pages runs Jekyll unless told not to, and Jekyll drops files it does not like.
writeFileSync(join(OUT, '.nojekyll'), '')

async function releases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'uvd-website-build' }
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  const all = []
  for (let page = 1; page < 20; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the releases`)
    const list = await res.json()
    all.push(...list)
    if (list.length < 100) break
  }
  // Only what the page reads: a version, its date and the files people install.
  return all
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      date: r.published_at,
      prerelease: r.prerelease,
      url: r.html_url,
      assets: r.assets
        .filter((a) => /\.(exe|dmg|deb|rpm|AppImage)$/i.test(a.name))
        .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
    }))
}

if (!process.argv.includes('--no-releases')) {
  const list = await releases()
  writeFileSync(join(OUT, 'releases.json'), JSON.stringify(list))
  console.log(`  • releases.json: ${list.length} versions`)
}
console.log(`  • website in ${OUT}${existsSync(join(OUT, 'rpm')) ? ' (beside the dnf repository)' : ''}`)
