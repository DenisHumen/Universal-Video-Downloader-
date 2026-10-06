import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '@shared/types'
import {
  freeCopySuffix,
  pickOutputStem,
  samePath,
  sectionSuffix,
  sectionTime,
  shouldTakeOwnName,
  waitsForNamesake,
  withNameSuffix,
  type StemChoice
} from './naming'

/*
  The engine treats a file that already has the requested name as the job
  done. Every request that shared a name therefore shared a file: a clip and
  then the full video gave the clip, twice, and both rows said completed.
*/

describe('sectionTime', () => {
  it('writes a moment without colons', () => {
    expect(sectionTime(5)).toBe('0m05s')
    expect(sectionTime(65)).toBe('1m05s')
    expect(sectionTime(3725)).toBe('1h02m05s')
  })

  it('keeps tenths only when the cut has them', () => {
    expect(sectionTime(5.5)).toBe('0m05.5s')
    expect(sectionTime(5.04)).toBe('0m05s')
    expect(sectionTime(59.96)).toBe('1m00s')
  })
})

describe('sectionSuffix', () => {
  it('names a closed range', () => {
    expect(sectionSuffix({ start: 5, end: 9 })).toBe(' [0m05s-0m09s]')
    expect(sectionSuffix({ end: 60 })).toBe(' [0m00s-1m00s]')
  })

  it('says "end" for an open end instead of the engine\'s NA', () => {
    // %(section_end)s renders as "NA" when the extractor does not know the length.
    expect(sectionSuffix({ start: 5 })).toBe(' [0m05s-end]')
  })

  it('adds nothing for the whole video', () => {
    expect(sectionSuffix(undefined)).toBe('')
    expect(sectionSuffix({ start: 0 })).toBe('')
  })
})

describe('withNameSuffix', () => {
  it('goes before the extension field', () => {
    expect(withNameSuffix('%(title)s [%(id)s].%(ext)s', ' [0m05s-end]')).toBe(
      '%(title)s [%(id)s] [0m05s-end].%(ext)s'
    )
  })

  it('goes on the end of a template without one', () => {
    expect(withNameSuffix('%(title)s', ' (2)')).toBe('%(title)s (2)')
  })

  it('leaves folders in the template alone', () => {
    expect(withNameSuffix('%(uploader)s/%(title)s.%(ext)s', ' [0m05s-0m09s] (2)')).toBe(
      '%(uploader)s/%(title)s [0m05s-0m09s] (2).%(ext)s'
    )
  })

  it('changes nothing when there is nothing to add', () => {
    expect(withNameSuffix('%(title)s.%(ext)s', '')).toBe('%(title)s.%(ext)s')
  })
})

function choice(overrides: Partial<StemChoice> = {}): StemChoice {
  return { wanted: 'Episode 1', held: new Set(), finished: new Set(), names: [], ...overrides }
}

describe('pickOutputStem', () => {
  it('takes the title when nothing else has it', () => {
    expect(pickOutputStem(choice())).toBe('Episode 1')
  })

  it('numbers a second stream captured from the same page while the first is running', () => {
    // Every stream from one page is titled after the page; both used to write Episode 1.mp4.part.
    expect(pickOutputStem(choice({ held: new Set(['episode 1']) }))).toBe('Episode 1 (2)')
    expect(pickOutputStem(choice({ held: new Set(['episode 1', 'episode 1 (2)']) }))).toBe(
      'Episode 1 (3)'
    )
  })

  it('steps around what is already in the folder, partials included', () => {
    expect(pickOutputStem(choice({ names: ['Episode 1.mp4'] }))).toBe('Episode 1 (2)')
    expect(pickOutputStem(choice({ names: ['episode 1.mp4.part'] }))).toBe('Episode 1 (2)')
    expect(pickOutputStem(choice({ names: ['Episode 10.mp4'] }))).toBe('Episode 1')
  })

  it('keeps its own name across a pause and resume, partial and all', () => {
    // Picking afresh would find its own .part "taken" and restart under (2).
    const resumed = choice({ current: 'Episode 1', names: ['Episode 1.mp4.part', 'Episode 1.mp4.ytdl'] })
    expect(pickOutputStem(resumed)).toBe('Episode 1')
  })

  it('gives its name up when someone else took it while it sat in error', () => {
    expect(pickOutputStem(choice({ current: 'Episode 1', held: new Set(['episode 1']) }))).toBe(
      'Episode 1 (2)'
    )
    const finishedInto = choice({
      current: 'Episode 1',
      finished: new Set(['episode 1.mp4']),
      names: ['Episode 1.mp4']
    })
    expect(pickOutputStem(finishedInto)).toBe('Episode 1 (2)')
  })

  it('keeps the bare title for an entry from an older version with partials on disk', () => {
    const upgraded = choice({
      wanted: 'Episode 1 [0m05s-end]',
      legacy: 'Episode 1',
      names: ['Episode 1.mp4.part']
    })
    expect(pickOutputStem(upgraded)).toBe('Episode 1')
  })

  it('does not hand an old partial to an entry when another one in flight holds it', () => {
    const contested = choice({
      legacy: 'Episode 1',
      held: new Set(['episode 1']),
      names: ['Episode 1.mp4.part']
    })
    expect(pickOutputStem(contested)).toBe('Episode 1 (2)')
  })
})

describe('freeCopySuffix', () => {
  it('starts at 2 and skips numbers the folder already has', () => {
    expect(freeCopySuffix('Talk [abc]', ['Talk [abc].mp4'])).toBe(' (2)')
    expect(freeCopySuffix('Talk [abc]', ['Talk [abc].mp4', 'talk [abc] (2).mp4'])).toBe(' (3)')
  })
})

describe('samePath', () => {
  it('ignores slash direction and case', () => {
    expect(samePath('C:\\Downloads\\Clip.mp4', 'c:/downloads/clip.mp4')).toBe(true)
    expect(samePath('C:\\Downloads\\Clip.mp4', 'C:\\Downloads\\Clip (2).mp4')).toBe(false)
  })
})

function entry(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 'new',
    url: 'https://site.test/watch/1',
    sourceUrl: 'https://site.test/watch/1',
    title: 'Talk',
    kind: 'download',
    mode: 'video',
    quality: 'best',
    state: 'downloading',
    percent: 0,
    outputDir: 'C:\\dl',
    createdAt: 2,
    ...overrides
  }
}

describe('shouldTakeOwnName', () => {
  const FILE = 'C:\\dl\\Talk [1].mp4'

  it('refuses the clip as the full video', () => {
    // The reported case: the full download finished at once, on a 2-second clip.
    const clip = entry({ id: 'clip', state: 'completed', range: { start: 0, end: 2 }, filepath: FILE })
    expect(shouldTakeOwnName(entry(), FILE, [clip, entry()])).toBe(true)
  })

  it('refuses another quality of the same video', () => {
    const hd = entry({ id: 'hd', state: 'completed', quality: '720', filepath: FILE })
    expect(shouldTakeOwnName(entry(), FILE, [hd, entry()])).toBe(true)
  })

  it('refuses a file nothing in the queue accounts for', () => {
    expect(shouldTakeOwnName(entry({ range: { start: 5 } }), FILE, [])).toBe(true)
  })

  it('accepts the file when the same request finished into it', () => {
    const before = entry({ id: 'before', state: 'completed', filepath: 'c:/dl/talk [1].mp4' })
    expect(shouldTakeOwnName(entry(), FILE, [before, entry()])).toBe(false)
  })

  it('accepts the entry\'s own earlier file', () => {
    const self = entry({ filepath: FILE })
    expect(shouldTakeOwnName(self, FILE, [self])).toBe(false)
  })

  it('does not count a same-request entry that never finished', () => {
    const failed = entry({ id: 'failed', state: 'error', filepath: FILE })
    expect(shouldTakeOwnName(entry(), FILE, [failed])).toBe(true)
  })

  it('retries only once, so it cannot loop', () => {
    expect(shouldTakeOwnName(entry({ copySuffix: ' (2)' }), FILE, [])).toBe(false)
  })

  it('leaves custom-resolved streams, already named uniquely, alone', () => {
    expect(shouldTakeOwnName(entry({ outputStem: 'Talk' }), FILE, [])).toBe(false)
  })

  it('leaves a request that narrows nothing alone', () => {
    expect(shouldTakeOwnName(entry({ quality: undefined }), FILE, [])).toBe(false)
  })
})

describe('waitsForNamesake', () => {
  const queued = (overrides: Partial<DownloadItem> = {}): DownloadItem =>
    entry({ state: 'queued', quality: '720', ...overrides })

  it('holds the same link at another quality while the first is running', () => {
    // Both engines appended to "Talk [1].f140.m4a.part" and raced to merge into "Talk [1].mp4".
    for (const state of ['detecting', 'downloading', 'processing'] as const) {
      expect(waitsForNamesake(queued(), [entry({ id: 'best', state })])).toBe(true)
    }
  })

  it('lets it start once the first is no longer running', () => {
    // The sequential case is shouldTakeOwnName's: the second run finds the file and takes " (2)".
    for (const state of ['queued', 'paused', 'completed', 'error', 'canceled'] as const) {
      expect(waitsForNamesake(queued(), [entry({ id: 'best', state })])).toBe(false)
    }
  })

  it('does not wait for itself', () => {
    expect(waitsForNamesake(queued({ id: 'best' }), [entry({ id: 'best' })])).toBe(false)
  })

  it('does not hold a different link', () => {
    const other = entry({ id: 'other', url: 'https://site.test/watch/2', sourceUrl: 'https://site.test/watch/2' })
    expect(waitsForNamesake(queued(), [other])).toBe(false)
  })

  it('goes by the link that was queued, not the one it resolved to', () => {
    const resolved = entry({ id: 'best', url: 'https://cdn.test/1.m3u8' })
    expect(waitsForNamesake(queued(), [resolved])).toBe(true)
  })

  it('does not hold another section, which has a name of its own', () => {
    const clip = entry({ id: 'clip', range: { start: 0, end: 2 } })
    expect(waitsForNamesake(queued(), [clip])).toBe(false)
    expect(waitsForNamesake(queued({ range: { start: 0, end: 2 } }), [clip])).toBe(true)
  })

  it('does not hold an entry already numbered apart', () => {
    expect(waitsForNamesake(queued({ copySuffix: ' (2)' }), [entry({ id: 'best' })])).toBe(false)
    expect(waitsForNamesake(queued(), [entry({ id: 'best', copySuffix: ' (2)' })])).toBe(false)
  })

  it('leaves trim and convert jobs out, which name their own files', () => {
    expect(waitsForNamesake(queued({ kind: 'trim' }), [entry({ id: 'best' })])).toBe(false)
    expect(waitsForNamesake(queued(), [entry({ id: 'job', kind: 'convert' })])).toBe(false)
  })
})
