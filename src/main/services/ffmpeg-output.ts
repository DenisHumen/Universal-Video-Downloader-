/**
 * Reading ffmpeg's console chatter, which the engine passes through verbatim.
 *
 * Some downloads never touch yt-dlp's own downloader at all. A trimmed
 * download (`--download-sections`) and most live/HLS captures are handed to
 * ffmpeg, which yt-dlp spawns with its console inherited — so none of the
 * `--progress-template` lines the app asks for are ever printed, and ffmpeg's
 * own status line arrives on stderr instead.
 *
 * That is why "cut a section, then download" showed a bar that never moved:
 * there was nothing to move it with. ffmpeg says exactly how far it has got,
 * once a second, in a format that has not changed in fifteen years — it just
 * says it on the wrong stream, in the wrong shape, separated by carriage
 * returns rather than newlines.
 */

/**
 * ffmpeg overwrites one status line using `\r`, so a chunk of its output is
 * not newline-separated the way every other line-based parser assumes.
 */
export function splitOutputLines(chunk: string): string[] {
  return chunk.split(/\r\n|\r|\n/)
}

/** `frame= 240 fps=30 … time=00:00:08.00 bitrate=… speed=1.5x` */
const STATUS_LINE = /(?:^|\s)(?:frame|size)=\s*\S+.*\btime=\s*(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/

/**
 * How many seconds of output ffmpeg has written, or undefined when the line
 * isn't a status line.
 *
 * Negative timestamps happen at the very start of a cut that begins before the
 * first keyframe; they are not progress, so they read as zero.
 */
export function ffmpegProgressSeconds(line: string): number | undefined {
  const m = line.match(STATUS_LINE)
  if (!m) return undefined
  const [, negative, h, min, s] = m
  const seconds = Number(h) * 3600 + Number(min) * 60 + Number(s)
  if (!Number.isFinite(seconds)) return undefined
  return negative ? 0 : seconds
}

/**
 * Lines worth keeping out of the log drawer.
 *
 * ffmpeg prints a status line every second. On a twenty-minute encode that is
 * more than a thousand of them, and the log keeps only its last few thousand
 * characters — so the actual error, printed once at the end of a failed run,
 * was reliably pushed out by the noise that came after it. The drawer is
 * called "engine output" and it existed to answer "why did this fail".
 */
export function isFfmpegNoise(line: string): boolean {
  if (STATUS_LINE.test(line)) return true
  // Never drop a line that could be the explanation. ffmpeg tags its demuxer
  // complaints with the same `[hls @ 0x…]` prefix it uses for chatter, so the
  // prefix alone cannot decide — "Failed to open segment" arrives wearing it.
  if (/\b(error|failed|invalid|denied|unable|forbidden|unauthoriz|no such|not found)\b/i.test(line)) {
    return false
  }
  return /^\s*(?:\[(?:hls|https?|tls|mp4|matroska|out#|in#)[^\]]*\]|Press \[q\]|Last message repeated)/i.test(
    line
  )
}
