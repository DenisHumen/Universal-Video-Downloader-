import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/*
  L1: Ubuntu Sans and Ubuntu Sans Mono v1.006 ship unmodified (no subsetting,
  no re-encoding) under the Ubuntu Font Licence 1.0, with its full text. The
  hashes are those of the upstream v1.006 variable TTFs (as packaged in
  Ubuntu 24.04's fonts-ubuntu: UbuntuSans[wdth,wght].ttf and
  UbuntuSansMono[wght].ttf).
*/

const sha = (file: string): string => createHash('sha256').update(readFileSync(join(__dirname, file))).digest('hex')

describe('bundled fonts', () => {
  it('are the upstream files, byte for byte', () => {
    expect(sha('UbuntuSans-wdth-wght.ttf')).toBe('37e90bba45a2a1172d9f6078e45daebaa1b4e537943205cc1309f142a254fe40')
    expect(sha('UbuntuSansMono-wght.ttf')).toBe('507870a3fe5737eb5b02f366587d30607c02a5ad45d8fe94b3ee20a80ccad32a')
  })

  it('come with the full Ubuntu Font Licence 1.0', () => {
    const text = readFileSync(join(__dirname, 'UFL-1.0.txt'), 'utf-8')
    expect(text).toMatch(/^UBUNTU FONT LICENCE Version 1\.0/)
    expect(text).toMatch(/DEALINGS IN THE FONT SOFTWARE\.\s*$/)
  })
})
