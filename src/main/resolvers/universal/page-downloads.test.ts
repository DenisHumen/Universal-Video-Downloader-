import { describe, expect, it } from 'vitest'
import { downloadVerdict, floodGuard } from './page-downloads'

/*
  The browsing session had no download handler, so Electron's default applied
  to every page in it: a native Save dialog. The hidden sniffer loads pages
  nobody is looking at and clicks their play buttons, so that dialog could pop
  up out of nowhere, and a page could keep starting downloads that bypassed the
  queue, the download folder and the naming rules.
*/

const MP4 = 'https://cdn.example.com/files/episode-3.mp4'

describe('downloadVerdict', () => {
  it('cancels anything from a page that is not on screen, media or not', () => {
    for (const mimeType of ['video/mp4', 'application/zip', '']) {
      expect(downloadVerdict({ url: MP4, mimeType, onScreen: false, flooding: false }), mimeType).toBe(
        'cancel'
      )
    }
  })

  it('sends a web video or audio file from the visible browser to the queue', () => {
    expect(downloadVerdict({ url: MP4, mimeType: 'video/mp4', onScreen: true, flooding: false })).toBe('queue')
    expect(
      downloadVerdict({
        url: 'http://cdn.example.com/a.m4a',
        mimeType: 'AUDIO/MP4',
        onScreen: true,
        flooding: false
      })
    ).toBe('queue')
  })

  it('never reroutes what the engine cannot fetch or the app has no business with', () => {
    const keepDialog = [
      { url: 'blob:https://site.example/5d1c', mimeType: 'video/mp4' },
      { url: 'data:video/mp4;base64,AAAA', mimeType: 'video/mp4' },
      { url: 'https://site.example/archive.zip', mimeType: 'application/zip' },
      { url: 'https://site.example/movie.mp4', mimeType: 'application/octet-stream' },
      { url: 'https://site.example/report.pdf', mimeType: '' }
    ]
    for (const download of keepDialog) {
      expect(downloadVerdict({ ...download, onScreen: true, flooding: false }), download.url).toBe('ask')
    }
  })

  it('cancels once a page keeps starting downloads', () => {
    expect(downloadVerdict({ url: MP4, mimeType: 'video/mp4', onScreen: true, flooding: true })).toBe('cancel')
    expect(
      downloadVerdict({ url: 'https://a.example/x.zip', mimeType: 'application/zip', onScreen: true, flooding: true })
    ).toBe('cancel')
  })
})

describe('floodGuard', () => {
  it('lets the first few through and refuses the next', () => {
    const tooMany = floodGuard(3, 10_000)
    expect([0, 1, 2].map((i) => tooMany('page', 1000 + i))).toEqual([false, false, false])
    expect(tooMany('page', 1003)).toBe(true)
  })

  it('keeps refusing a page that starts downloads in a loop', () => {
    const tooMany = floodGuard(3, 10_000)
    let refused = 0
    // One every half second for a minute: the window never empties.
    for (let at = 0; at < 60_000; at += 500) if (tooMany('page', at)) refused++
    expect(refused).toBe(120 - 3)
  })

  it('forgives a page once it has been quiet for the whole window', () => {
    const tooMany = floodGuard(2, 10_000)
    tooMany('page', 0)
    tooMany('page', 1)
    expect(tooMany('page', 2)).toBe(true)
    expect(tooMany('page', 10_003)).toBe(false)
  })

  it('counts each page on its own', () => {
    const tooMany = floodGuard(1, 10_000)
    expect(tooMany('one', 0)).toBe(false)
    expect(tooMany('two', 0)).toBe(false)
    expect(tooMany('one', 1)).toBe(true)
  })
})
