import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { AppSettings, DownloadItem, PlaylistPlace } from '@shared/types'
import { normalisePlaylist, playlistDir, playlistTagArgs } from './playlist'
import { outputTarget } from './downloader'

/*
  Playlist entries download one at a time with `--no-playlist`, so the engine
  cannot number them or file them together: a 40-part course landed in the
  download root in whatever order the parts finished. These are the folder,
  the track tag and the `-o` the engine is handed; the names themselves are
  tested in shared/playlist.test.ts.
*/

const place = (overrides: Partial<PlaylistPlace> = {}): PlaylistPlace => ({
  title: 'Course',
  index: 7,
  count: 40,
  folder: true,
  numbered: true,
  ...overrides
})

const settings = (overrides: Partial<AppSettings> = {}): AppSettings =>
  ({ filenameTemplate: '%(title)s [%(id)s].%(ext)s', ...overrides }) as AppSettings

const item = (overrides: Partial<DownloadItem> = {}): DownloadItem => ({
  id: 'a',
  url: 'https://site/video',
  title: 'Video',
  mode: 'video',
  state: 'downloading',
  percent: 0,
  outputDir: '/dl',
  createdAt: 1,
  ...overrides
})

describe('playlistDir', () => {
  it('adds a folder named after the playlist when asked', () => {
    expect(playlistDir('/dl', place())).toBe(join('/dl', 'Course'))
    expect(playlistDir('/dl', place({ folder: false }))).toBe('/dl')
    expect(playlistDir('/dl', undefined)).toBe('/dl')
  })
})

describe('outputTarget', () => {
  it('numbers the template inside the playlist folder', () => {
    const dir = playlistDir('/dl', place())
    expect(outputTarget(item({ playlist: place() }), settings(), dir)).toEqual({
      path: join('/dl', 'Course', '07 - %(title)s [%(id)s].%(ext)s')
    })
  })

  it('numbers the file inside a template that sorts into folders', () => {
    const target = outputTarget(
      item({ playlist: place({ index: 3, count: 12 }) }),
      settings({ filenameTemplate: '%(uploader)s/%(title)s.%(ext)s' }),
      '/dl'
    )
    expect(target.path).toBe(join('/dl', '%(uploader)s', '03 - %(title)s.%(ext)s'))
  })

  // A resolved stream gets the title the app scraped, and is found again by
  // that stem; a stem without the number would never match the file on disk.
  it('numbers the baked stem as well as the path', () => {
    const target = outputTarget(
      item({ title: 'Episode: one', referer: 'https://site/', playlist: place() }),
      settings(),
      '/dl'
    )
    expect(target).toEqual({ path: join('/dl', '07 - Episode one.%(ext)s'), stem: '07 - Episode one' })
  })

  it('names a single video exactly as before', () => {
    expect(outputTarget(item(), settings(), '/dl')).toEqual({
      path: join('/dl', '%(title)s [%(id)s].%(ext)s')
    })
    expect(outputTarget(item({ referer: 'https://site/' }), settings(), '/dl')).toEqual({
      path: join('/dl', 'Video.%(ext)s'),
      stem: 'Video'
    })
  })
})

describe('playlistTagArgs', () => {
  it('tags the position as track n of the list', () => {
    expect(playlistTagArgs(place(), true)).toEqual([
      '--postprocessor-args',
      'Metadata+ffmpeg:-metadata track=7/40'
    ])
  })

  // The arguments are addressed to the Metadata post-processor, which only
  // runs while metadata is being embedded.
  it('adds nothing without embedded metadata, or outside a playlist', () => {
    expect(playlistTagArgs(place(), false)).toEqual([])
    expect(playlistTagArgs(undefined, true)).toEqual([])
  })
})

describe('normalisePlaylist', () => {
  // It comes over IPC and ends up in a file name and on ffmpeg's command line.
  it('refuses a position that is not a positive whole number', () => {
    for (const index of [0, -1, 1.5, Number.NaN, 'x', undefined]) {
      expect(normalisePlaylist({ title: 'P', index, count: 3 })).toBeUndefined()
    }
    expect(normalisePlaylist(undefined)).toBeUndefined()
    expect(normalisePlaylist('playlist')).toBeUndefined()
  })

  it('keeps a well-formed place, and only a literal true switches anything on', () => {
    expect(normalisePlaylist({ title: 'P', index: 2, count: 5, folder: true, numbered: 'yes' })).toEqual({
      title: 'P',
      index: 2,
      count: 5,
      folder: true,
      numbered: false
    })
  })

  // A list that grew between listing and queueing: track 41 of 40 is no use.
  it('stretches a count shorter than the position', () => {
    expect(normalisePlaylist({ title: 'P', index: 41, count: 40 })?.count).toBe(41)
    expect(normalisePlaylist({ index: 3 })).toEqual({
      title: '',
      index: 3,
      count: 3,
      folder: false,
      numbered: false
    })
  })
})
