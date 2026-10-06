import { describe, expect, it } from 'vitest'
import { leftoversOf, mayRemoveFolder, splitLocalPath } from './cleanup'

/*
  "Delete the local copy" removed the episode and left its thumbnail, subtitles,
  partial files and folder behind - so Downloads filled up anyway.
*/
describe('leftoversOf', () => {
  const folder = [
    'Show s1e2.mp4',
    'Show s1e2.jpg',
    'Show s1e2.webp',
    'Show s1e2.ru.srt',
    'Show s1e2.en-US.vtt',
    'Show s1e2.mp4.part',
    'Show s1e2.f137.mp4.part',
    'Show s1e2.mp4.ytdl',
    'Show s1e2.info.json',
    'Show s1e20.mp4',
    'Show s1e20.jpg',
    'Show s1e2 (1).mp4',
    'Other.jpg',
    'Show s1e2.mkv',
  ]

  it('takes what the same download wrote beside the episode', () => {
    expect(leftoversOf('Show s1e2.mp4', folder).sort()).toEqual(
      [
        'Show s1e2.en-US.vtt',
        'Show s1e2.f137.mp4.part',
        'Show s1e2.info.json',
        'Show s1e2.jpg',
        'Show s1e2.mp4.part',
        'Show s1e2.mp4.ytdl',
        'Show s1e2.ru.srt',
        'Show s1e2.webp',
      ].sort()
    )
  })

  it('never takes a neighbour with a similar name, or another media file', () => {
    const picked = leftoversOf('Show s1e2.mp4', folder)
    for (const name of ['Show s1e20.mp4', 'Show s1e20.jpg', 'Show s1e2 (1).mp4', 'Other.jpg', 'Show s1e2.mkv']) {
      expect(picked).not.toContain(name)
    }
  })

  it('leaves the episode itself to the caller', () => {
    expect(leftoversOf('Show s1e2.mp4', folder)).not.toContain('Show s1e2.mp4')
  })
})

describe('mayRemoveFolder', () => {
  const root = 'C:\\Users\\me\\Downloads'

  it('allows a folder the app made inside the download directory', () => {
    expect(mayRemoveFolder('C:\\Users\\me\\Downloads\\YummyAnime', root)).toBe(true)
    expect(mayRemoveFolder('C:/Users/me/Downloads/YummyAnime/Show', root)).toBe(true)
  })

  it('never the download directory itself, or anything outside it', () => {
    expect(mayRemoveFolder(root, root)).toBe(false)
    expect(mayRemoveFolder('C:\\Users\\me\\Downloads\\', root)).toBe(false)
    expect(mayRemoveFolder('C:\\Users\\me\\Videos', root)).toBe(false)
    expect(mayRemoveFolder('C:\\Users\\me\\DownloadsOld\\x', root)).toBe(false)
    expect(mayRemoveFolder('C:\\anything', '')).toBe(false)
  })
})

describe('splitLocalPath', () => {
  it('reads both kinds of slash', () => {
    expect(splitLocalPath('C:\\a\\b\\Show s1e2.mp4')).toEqual({ dir: 'C:\\a\\b', name: 'Show s1e2.mp4' })
    expect(splitLocalPath('/home/a/Show.mp4')).toEqual({ dir: '/home/a', name: 'Show.mp4' })
  })
})
