import { describe, expect, it } from 'vitest'
import { partialStem, partialsFor } from './downloader'

/*
  These two functions decide which files a cancelled download is allowed to
  delete. They have twice been the cause of a download destroying another
  download's progress, so they get the tests that the incidents earned.
*/

describe('partialStem', () => {
  it('splits on the last dot, not the first', () => {
    // "3.5 Hours of Rain.mp4" once yielded the stem "3", which then matched
    // every partial in the folder that happened to start with a 3.
    expect(partialStem('3.5 Hours of Rain.mp4')).toBe('3.5 Hours of Rain')
    expect(partialStem('Lecture 1 [abc123].mp4')).toBe('Lecture 1 [abc123]')
  })

  it('takes the file out of a path, either slash', () => {
    expect(partialStem('C:\\Users\\me\\Downloads\\clip.mp4')).toBe('clip')
    expect(partialStem('/home/me/Downloads/clip.mp4')).toBe('clip')
  })

  it('leaves a name with no extension alone', () => {
    expect(partialStem('no-extension')).toBe('no-extension')
    // A leading dot is the whole name, not an extension.
    expect(partialStem('.hidden')).toBe('.hidden')
  })
})

describe('partialsFor', () => {
  const folder = [
    'Lecture 1 [aaa].mp4.part',
    'Lecture 1 [aaa].mp4.ytdl',
    'Lecture 1 [aaa].f137.mp4.part',
    'Lecture 1 [aaa].f140.m4a.part',
    'Lecture 10 [bbb].mp4.part',
    'Lecture 1 [aaa].mp4',
    'Something Else.mp4.part',
    'notes.txt'
  ]

  it('takes the output file and the per-format parts of the same download', () => {
    expect(partialsFor(folder, 'Lecture 1 [aaa]').sort()).toEqual([
      'Lecture 1 [aaa].f137.mp4.part',
      'Lecture 1 [aaa].f140.m4a.part',
      'Lecture 1 [aaa].mp4.part',
      'Lecture 1 [aaa].mp4.ytdl'
    ])
  })

  it('leaves the download whose name merely starts the same way', () => {
    // The whole point: "Lecture 1" is a prefix of "Lecture 10", and that one is
    // still running.
    expect(partialsFor(folder, 'Lecture 1 [aaa]')).not.toContain('Lecture 10 [bbb].mp4.part')
  })

  it('leaves finished files and unrelated files alone', () => {
    const taken = partialsFor(folder, 'Lecture 1 [aaa]')
    expect(taken).not.toContain('Lecture 1 [aaa].mp4')
    expect(taken).not.toContain('Something Else.mp4.part')
    expect(taken).not.toContain('notes.txt')
  })

  it('refuses to act on a stem too short to identify anything', () => {
    expect(partialsFor(['a.mp4.part', 'ab.mp4.part'], 'a')).toEqual([])
  })

  it('is not fooled by regex characters in a title', () => {
    const names = ['Q3 (2024) [x].mp4.part', 'Q3 12024y [x].mp4.part']
    expect(partialsFor(names, 'Q3 (2024) [x]')).toEqual(['Q3 (2024) [x].mp4.part'])
  })
})
