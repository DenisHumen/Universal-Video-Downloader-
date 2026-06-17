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
const buildDir = join(root, 'build')
const iconsDir = join(buildDir, 'icons')

if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true })
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })

const svg = readFileSync(svgPath)

async function render(size, outPath) {
  await sharp(svg, { density: 384 })
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
console.log('Done.')
