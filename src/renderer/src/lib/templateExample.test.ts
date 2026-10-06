import { describe, expect, it } from 'vitest'
import { renderTemplate, templateExample } from './templateExample'

/*
  The example under the filename template. The expected names below are what
  yt-dlp itself printed for the same made-up video, loaded as its info JSON.
*/

const posix = {
  restrictFilenames: false,
  siteFolders: false,
  playlistFolder: true,
  playlistNumbering: true,
  sep: '/'
}

const fields = { title: 'Big Buck Bunny', id: 'aqz-KE-bpKQ', ext: 'mp4', upload_date: '20141110', height: 1080 }

describe('templateExample', () => {
  it('names a video and the same video from a playlist', () => {
    expect(templateExample('%(title)s [%(id)s].%(ext)s', posix)).toEqual({
      video: 'Big Buck Bunny [aqz-KE-bpKQ].mp4',
      playlist: 'Open Movies/07 - Big Buck Bunny [aqz-KE-bpKQ].mp4'
    })
  })

  // An empty field is saved as is, and main falls back to its default.
  it('shows the default for an empty template', () => {
    expect(templateExample('', posix).video).toBe('Big Buck Bunny [aqz-KE-bpKQ].mp4')
  })

  // The number goes on the file, not on a folder the template sorts into.
  it('numbers the file name inside a template that makes folders', () => {
    expect(templateExample('%(uploader)s/%(title)s.%(ext)s', posix).playlist).toBe(
      'Open Movies/Blender/07 - Big Buck Bunny.mp4'
    )
  })

  it('follows the playlist choices, and drops the line when they change nothing', () => {
    expect(templateExample('%(title)s.%(ext)s', { ...posix, playlistFolder: false }).playlist).toBe(
      '07 - Big Buck Bunny.mp4'
    )
    expect(templateExample('%(title)s.%(ext)s', { ...posix, playlistNumbering: false }).playlist).toBe(
      'Open Movies/Big Buck Bunny.mp4'
    )
    expect(
      templateExample('%(title)s.%(ext)s', { ...posix, playlistFolder: false, playlistNumbering: false })
    ).toEqual({ video: 'Big Buck Bunny.mp4' })
  })

  it('puts the per-site folder in front of everything', () => {
    expect(templateExample('%(title)s.%(ext)s', { ...posix, siteFolders: true })).toEqual({
      video: 'Youtube/Big Buck Bunny.mp4',
      playlist: 'Youtube/Open Movies/07 - Big Buck Bunny.mp4'
    })
  })

  // Entries run with --no-playlist: a template built on the engine's own
  // playlist fields gets its placeholder, and the example has to say so.
  it('shows the engine placeholder for playlist fields', () => {
    expect(templateExample('%(playlist_index)s - %(title)s.%(ext)s', posix).video).toBe(
      'NA - Big Buck Bunny.mp4'
    )
    expect(templateExample('%(playlist_title|no list)s - %(title)s.%(ext)s', posix).video).toBe(
      'no list - Big Buck Bunny.mp4'
    )
  })

  // And every entry is its own run of the engine, so its counter is always 1.
  it('shows autonumber as the engine leaves it', () => {
    expect(templateExample('%(autonumber)s %(title)s.%(ext)s', posix).video).toBe('00001 Big Buck Bunny.mp4')
  })

  it('uses backslashes on Windows, where the engine also swaps what a name cannot hold for #', () => {
    expect(templateExample('%(uploader)s/%(title)s: part.%(ext)s', { ...posix, sep: '\\' })).toEqual({
      video: 'Blender\\Big Buck Bunny# part.mp4',
      playlist: 'Open Movies\\Blender\\07 - Big Buck Bunny# part.mp4'
    })
  })

  it('follows restricted file names', () => {
    expect(templateExample('%(title)s [%(id)s].%(ext)s', { ...posix, restrictFilenames: true }).video).toBe(
      'Big_Buck_Bunny [aqz-KE-bpKQ].mp4'
    )
  })
})

describe('renderTemplate', () => {
  // A slash from a date format is part of the name, not a folder.
  it('formats dates, and keeps a slash in a value out of the path', () => {
    expect(renderTemplate('%(upload_date>%Y-%m-%d)s', fields, false)).toBe('2014-11-10')
    expect(renderTemplate('%(upload_date>%Y/%m)s', fields, false)).toBe('2014⧸11')
    expect(renderTemplate('%(upload_date>%Y/%m)s', fields, true)).toBe('2014_11')
    expect(renderTemplate('%(upload_date>%d %B %Y)s', fields, false)).toBe('10 November 2014')
  })

  it('applies widths and precisions, padding after the value is made safe', () => {
    expect(renderTemplate('%(title).5s %(height)05d', fields, false)).toBe('Big B 01080')
    expect(renderTemplate('%(title)-20s|%(height)8d', fields, true)).toBe('Big_Buck_Bunny      |    1080')
  })

  it('reads alternatives, replacements and defaults', () => {
    expect(renderTemplate('%(uploader,title)s', fields, false)).toBe('Big Buck Bunny')
    expect(renderTemplate('%(title&by {})s', fields, false)).toBe('by Big Buck Bunny')
    expect(renderTemplate('%(release_date|undated)s', fields, false)).toBe('undated')
    expect(renderTemplate('%(playlist_index|)s%(title)s', fields, true)).toBe('Big_Buck_Bunny')
  })

  it('reads %% as a percent sign', () => {
    expect(renderTemplate('100%% %(title)s', fields, false)).toBe('100% Big Buck Bunny')
  })

  // Guessing would show a name the download will not have.
  it('leaves what it cannot preview as typed', () => {
    expect(renderTemplate('%(view_count)s %(formats.0.id)s %(upload_date>%A)s', fields, false)).toBe(
      '%(view_count)s %(formats.0.id)s %(upload_date>%A)s'
    )
    expect(renderTemplate('%(title)z %(constructor)s', fields, false)).toBe('%(title)z %(constructor)s')
  })
})
