// Rasterises assets/logo.svg into the platform icon assets electron-builder needs.
// electron-builder auto-derives .icns (macOS) and .ico (Windows) from build/icon.png,
// so a single high-resolution PNG is enough; we also emit a few Linux sizes.
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const svgPath = join(root, 'assets', 'logo.svg')
const traySvgPath = join(root, 'assets', 'tray.svg')
const dmgSvgPath = join(root, 'assets', 'dmg-background.svg')
const trayDarkSvgPath = join(root, 'assets', 'tray-dark.svg')
const buildDir = join(root, 'build')
const iconsDir = join(buildDir, 'icons')
/*
 * Runtime icons, as opposed to build-time ones.
 *
 * `build/` is electron-builder's buildResources directory: it is used to make
 * the installer and is deliberately *not* copied into the app, and `assets/` is
 * excluded from the package explicitly. Anything the running app loads has to
 * live somewhere that ships — which is what this directory is for. Loading a
 * missing path is not an error in Electron; `nativeImage` just hands back an
 * empty image, which is how the tray ended up as a blank square.
 */
const runtimeDir = join(root, 'resources', 'icons')

/** Must match `dmg.window` in electron-builder.yml, or the artwork lands crooked. */
const DMG_WIDTH = 660
const DMG_HEIGHT = 520

for (const dir of [buildDir, iconsDir, runtimeDir]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const svg = readFileSync(svgPath)
const traySvg = readFileSync(traySvgPath)
const trayDarkSvg = readFileSync(trayDarkSvgPath)

async function render(size, outPath, source = svg) {
  await sharp(source, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath)
  console.log(`  • ${outPath.replace(root + '/', '')} (${size}×${size})`)
}

console.log('Generating icons from assets/logo.svg…')
await render(1024, join(buildDir, 'icon.png'))
for (const size of [512, 256, 128, 64, 32, 16]) {
  await render(size, join(iconsDir, `${size}x${size}.png`))
}

console.log('Generating runtime icons…')
// Window icons: 256 is what Linux and the browser window ask for.
await render(256, join(runtimeDir, 'app.png'))
// Tray, from the dedicated glyph. The @2x/@3x suffixes are Electron's own
// convention — it picks the representation matching the display's scale, so the
// icon stays sharp on a 200% screen without any code choosing a size.
await render(16, join(runtimeDir, 'tray.png'), traySvg)
await render(32, join(runtimeDir, 'tray@2x.png'), traySvg)
await render(48, join(runtimeDir, 'tray@3x.png'), traySvg)
// The dark cut, for a light taskbar. Windows has no template images, so the
// app picks the glyph that contrasts with the system theme itself.
await render(16, join(runtimeDir, 'tray-dark.png'), trayDarkSvg)
await render(32, join(runtimeDir, 'tray-dark@2x.png'), trayDarkSvg)
await render(48, join(runtimeDir, 'tray-dark@3x.png'), trayDarkSvg)

/*
 * The macOS install window.
 *
 * Gatekeeper quarantines unsigned builds and reports that as "the app is
 * damaged", which reads like a bad download rather than a policy — so people
 * re-download it, get the same message, and give up. The fix is one command,
 * and this window is the only place we are certain to be read: it opens by
 * itself, before the app has ever run, which is exactly when the notice inside
 * the app cannot help because the app cannot start.
 *
 * Two files, because macOS picks the @2x variant on a Retina display and
 * upscaling the 1x one turns the command into mush.
 */
console.log('Generating the DMG background…')
const dmgSvg = readFileSync(dmgSvgPath)
for (const [scale, name] of [
  [1, 'background.png'],
  [2, 'background@2x.png']
]) {
  const out = join(buildDir, name)
  await sharp(dmgSvg, { density: 96 * scale })
    .resize(DMG_WIDTH * scale, DMG_HEIGHT * scale, { fit: 'fill' })
    .png()
    .toFile(out)
  console.log(`  • ${out.replace(root + '/', '')} (${DMG_WIDTH * scale}×${DMG_HEIGHT * scale})`)
}
console.log('Done.')
