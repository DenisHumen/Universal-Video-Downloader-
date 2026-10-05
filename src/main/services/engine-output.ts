import { StringDecoder } from 'string_decoder'

/**
 * A child's output pipe, as whole lines of text.
 *
 * Two things can tear a line, and both used to. A chunk boundary falls
 * wherever the pipe happens to flush, so a line naming the output file can
 * arrive in two halves - hence the carry-over. And the same boundary can fall
 * inside a character: a Cyrillic letter is two bytes in UTF-8, and decoding
 * each chunk on its own with `toString()` turned both halves into U+FFFD. The
 * engine writes its pipes in UTF-8 now (`--encoding utf-8`), which made the
 * second tear far more likely to land in a path, not less.
 *
 * The decoder keeps an incomplete character back until the rest of it arrives.
 */
export interface LineReader {
  push(chunk: Buffer | string): void
  /** Whatever followed the last separator. Call once the pipe has closed. */
  flush(): void
}

export function lineReader(
  split: (text: string) => string[],
  onLine: (line: string) => void
): LineReader {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  return {
    push(chunk) {
      carry += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      const lines = split(carry)
      carry = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    },
    flush() {
      const rest = carry + decoder.end()
      carry = ''
      if (rest) onLine(rest)
    }
  }
}
