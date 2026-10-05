import { describe, expect, it } from 'vitest'
import { cleanHtml } from './http'

describe('cleanHtml', () => {
  it('turns markup and entities into plain text', () => {
    expect(cleanHtml('<b>Tom &amp; Jerry</b> &quot;S01&quot; &#39;E02&#39;')).toBe('Tom & Jerry "S01" \'E02\'')
  })

  it('removes control characters a scraped title can carry', () => {
    // These titles become file names and engine arguments, and `spawn` throws
    // on a NUL instead of starting the download.
    expect(cleanHtml('Episode\u00001\u0007: Pilot\u007f')).toBe('Episode 1 : Pilot')
    expect(cleanHtml('\n\tTitle\r\n')).toBe('Title')
  })
})
