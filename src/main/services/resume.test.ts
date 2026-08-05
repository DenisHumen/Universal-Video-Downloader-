import { describe, expect, it } from 'vitest'
import type { DownloadItem, DownloadState } from '@shared/types'
import { markInterrupted, shouldResume, WAS_RUNNING } from './resume'

function item(state: DownloadState, extra: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 'a',
    url: 'https://site/video',
    title: 'Video',
    mode: 'video',
    state,
    percent: 40,
    outputDir: 'C:/dl',
    createdAt: 1,
    ...extra
  }
}

describe('markInterrupted', () => {
  it.each(WAS_RUNNING)('parks a %s item and flags it', (state) => {
    const it_ = item(state)
    expect(markInterrupted(it_)).toBe(true)
    expect(it_.state).toBe('paused')
    expect(it_.interrupted).toBe(true)
  })

  it.each<DownloadState>(['completed', 'error', 'canceled'])('leaves a %s item alone', (state) => {
    const it_ = item(state)
    expect(markInterrupted(it_)).toBe(false)
    expect(it_.state).toBe(state)
    expect(it_.interrupted).toBeUndefined()
  })

  it('never claims a pause the user asked for', () => {
    // This is the whole distinction: a paused item is not "still running", so
    // shutting down must not convert it into something to resume.
    const held = item('paused')
    expect(markInterrupted(held)).toBe(false)
    expect(held.interrupted).toBeUndefined()
    expect(shouldResume(held)).toBe(false)
  })
})

describe('shouldResume', () => {
  it('picks up what the app interrupted', () => {
    const cut = item('downloading')
    markInterrupted(cut)
    expect(shouldResume(cut)).toBe(true)
  })

  it('ignores a flagged item that has since moved on', () => {
    // resumeDownload clears the flag; a stale one must not resurrect anything.
    expect(shouldResume(item('downloading', { interrupted: true }))).toBe(false)
    expect(shouldResume(item('completed', { interrupted: true }))).toBe(false)
  })

  it('ignores an unflagged pause', () => {
    expect(shouldResume(item('paused'))).toBe(false)
  })
})

describe('the shutdown-then-launch round trip', () => {
  it('resumes a download that was running when the app quit', () => {
    // The case that was broken: shutdown parked it as `paused` and wrote that
    // to history, then loading saw a plain `paused` item and left it there.
    const live = item('downloading')

    markInterrupted(live) // before-quit
    const persisted = JSON.parse(JSON.stringify(live)) as DownloadItem

    markInterrupted(persisted) // next launch, reading history
    expect(shouldResume(persisted)).toBe(true)
  })

  it('still resumes when the app was killed before it could tidy up', () => {
    // No shutdown ran, so history holds the raw in-flight state.
    const persisted = item('downloading')
    markInterrupted(persisted)
    expect(shouldResume(persisted)).toBe(true)
  })

  it('does not resume something paused before quitting', () => {
    const held = item('paused')
    markInterrupted(held)
    const persisted = JSON.parse(JSON.stringify(held)) as DownloadItem
    markInterrupted(persisted)
    expect(shouldResume(persisted)).toBe(false)
  })
})
