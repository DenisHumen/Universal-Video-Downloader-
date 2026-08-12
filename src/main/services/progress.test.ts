import { describe, expect, it } from 'vitest'
import { acceptsPostprocess, DOWNLOAD_SHARE, overallProgress, postprocessorLabel } from './progress'

describe('overallProgress · download phase', () => {
  it('maps the download onto the first 90% of the bar', () => {
    expect(overallProgress({ phase: 'download', phasePercent: 0 }).percent).toBe(0)
    expect(overallProgress({ phase: 'download', phasePercent: 50 }).percent).toBe(45)
    expect(overallProgress({ phase: 'download', phasePercent: 100 }).percent).toBe(DOWNLOAD_SHARE)
  })

  it('never lets a finished download claim the whole bar', () => {
    // The point of the split: 100% downloaded is not 100% done.
    expect(overallProgress({ phase: 'download', phasePercent: 120 }).percent).toBe(DOWNLOAD_SHARE)
  })

  it('is indeterminate when the engine reports no figure', () => {
    // `--download-sections` on a fragmented stream reports no byte total, which
    // used to render as a confident 0% that never moved.
    const view = overallProgress({ phase: 'download' })
    expect(view.indeterminate).toBe(true)
    expect(view.percent).toBe(0)
  })

  it('holds its place while indeterminate rather than resetting', () => {
    expect(overallProgress({ phase: 'download', previous: 40 })).toEqual({
      percent: 40,
      indeterminate: true
    })
  })
})

describe('overallProgress · post-processing phase', () => {
  it('starts at the hand-over point even before the step reports anything', () => {
    // Entering post-processing means the download is done, whatever the last
    // download figure happened to be.
    expect(overallProgress({ phase: 'postprocess' })).toEqual({
      percent: DOWNLOAD_SHARE,
      indeterminate: true
    })
  })

  it('maps the step onto the last 10%', () => {
    expect(overallProgress({ phase: 'postprocess', phasePercent: 0 }).percent).toBe(90)
    expect(overallProgress({ phase: 'postprocess', phasePercent: 50 }).percent).toBe(95)
    expect(overallProgress({ phase: 'postprocess', phasePercent: 100 }).percent).toBe(100)
  })

  it('lifts a mid-download figure up to the hand-over point', () => {
    // A trimmed download can enter post-processing from 60%: the section
    // finished, the re-encode has not started.
    expect(overallProgress({ phase: 'postprocess', previous: 54 }).percent).toBe(DOWNLOAD_SHARE)
  })
})

describe('overallProgress · monotonicity', () => {
  it('never moves backwards within a phase', () => {
    expect(overallProgress({ phase: 'download', phasePercent: 10, previous: 45 }).percent).toBe(45)
  })

  it('never moves backwards across the hand-over', () => {
    expect(overallProgress({ phase: 'postprocess', phasePercent: 0, previous: 95 }).percent).toBe(95)
  })

  it('still respects each phase ceiling when carrying a previous figure', () => {
    // A stale 100 must not let the download phase paint a full bar.
    expect(overallProgress({ phase: 'download', phasePercent: 100, previous: 100 }).percent).toBe(
      DOWNLOAD_SHARE
    )
  })

  it('ignores a nonsense figure instead of trusting it', () => {
    expect(overallProgress({ phase: 'download', phasePercent: NaN }).indeterminate).toBe(true)
  })
})

describe('postprocessorLabel', () => {
  it('names the slow steps that made the bar look stuck', () => {
    expect(postprocessorLabel('ModifyChapters')).toBe('trim')
    expect(postprocessorLabel('SplitChapters')).toBe('trim')
    expect(postprocessorLabel('Merger')).toBe('merge')
    expect(postprocessorLabel('ExtractAudio')).toBe('convert')
    expect(postprocessorLabel('FFmpegVideoConvertor')).toBe('convert')
    expect(postprocessorLabel('FFmpegVideoRemuxer')).toBe('convert')
  })

  it('is case-insensitive, since the engine names its own classes', () => {
    expect(postprocessorLabel('ffmpegmerger')).toBe('merge')
  })

  it('says nothing rather than guessing', () => {
    expect(postprocessorLabel('MetadataParser')).toBeNull()
    expect(postprocessorLabel(undefined)).toBeNull()
    expect(postprocessorLabel('')).toBeNull()
  })
})

describe('overallProgress · a file finishing is not the job finishing', () => {
  it('holds its place and shows motion when the figure stops being known', () => {
    /*
      A default video download fetches the video and audio streams separately,
      so the engine reports `finished` once per stream. Treating the first one
      as the hand-over flipped the bar to post-processing — and burned the whole
      download share — while a second stream had not started.
    */
    expect(overallProgress({ phase: 'download', previous: 62 })).toEqual({
      percent: 62,
      indeterminate: true
    })
  })

  it('does not let the second stream drag the bar backwards', () => {
    // Each file reports its own 0-100%, so stream two starts near zero.
    expect(overallProgress({ phase: 'download', phasePercent: 3, previous: 88 }).percent).toBe(88)
  })
})

describe('acceptsPostprocess', () => {
  it('ignores a step that runs before the download', () => {
    // SponsorBlock, registered `after_filter`, reports before any bytes arrive.
    expect(acceptsPostprocess(undefined)).toBe(false)
  })

  it('honours a step once the download has started', () => {
    expect(acceptsPostprocess('download')).toBe(true)
    expect(acceptsPostprocess('postprocess')).toBe(true)
  })
})
