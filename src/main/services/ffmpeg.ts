import { dirname } from 'path'
import { existsSync } from 'fs'

/**
 * Resolve the bundled ffmpeg binary path. In a packaged app the binary lives in
 * app.asar.unpacked, but ffmpeg-static reports the in-asar path, so we remap it.
 */
export function ffmpegPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static') as string | null
    if (!ffmpegStatic) return undefined
    let p = ffmpegStatic
    if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      p = p.replace('app.asar', 'app.asar.unpacked')
    }
    return existsSync(p) ? p : ffmpegStatic
  } catch {
    return undefined
  }
}

/** Directory containing ffmpeg, suitable for yt-dlp's --ffmpeg-location. */
export function ffmpegLocation(): string | undefined {
  const p = ffmpegPath()
  return p ? dirname(p) : undefined
}
