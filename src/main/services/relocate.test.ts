import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem } from '@shared/types'

const h = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => h.dir } }))

type Downloader = typeof import('./downloader')

/*
  The automation renames an episode after the queue is done with it, and may
  delete it once it is on a share. The row kept the old path, so Play and Show
  in folder did nothing for every automated episode.
*/
describe('relocateItem', () => {
  let downloader: Downloader
  const item: DownloadItem = {
    id: 'd1',
    url: 'uvd-yummy://t/4/720p',
    title: 'Series s1e4',
    mode: 'video',
    state: 'completed',
    percent: 100,
    outputDir: '',
    filepath: '',
    createdAt: 1
  }

  beforeEach(async () => {
    h.dir = mkdtempSync(join(tmpdir(), 'uvd-relocate-'))
    item.outputDir = h.dir
    item.filepath = join(h.dir, 'd1.mp4')
    writeFileSync(join(h.dir, 'history.json'), JSON.stringify([item]))
    vi.resetModules()
    downloader = await import('./downloader')
    downloader.loadHistory()
  })

  afterEach(async () => {
    downloader.flushHistory()
    // Loading history reads the settings, whose first read schedules a save into this folder.
    const { flushSettings } = await import('./settings')
    flushSettings()
    rmSync(h.dir, { recursive: true, force: true })
  })

  it('points the row at the renamed file, and says so', () => {
    const heard: DownloadItem[] = []
    downloader.downloadEvents.on('updated', (i: DownloadItem) => heard.push(i))

    downloader.relocateItem('d1', { filepath: join(h.dir, 'Series - S01E04.mp4') })
    expect(downloader.getDownload('d1')?.filepath).toBe(join(h.dir, 'Series - S01E04.mp4'))
    expect(heard).toHaveLength(1)
  })

  // Sent as undefined, not left out: the screen merges updates, so an absent field keeps the dead path.
  it('drops the local path once only the share has the file', () => {
    const heard: DownloadItem[] = []
    downloader.downloadEvents.on('updated', (i: DownloadItem) => heard.push(i))

    downloader.relocateItem('d1', { filepath: undefined, remotePath: 'media/Series/ep.mp4' })
    expect(heard[0]).toHaveProperty('filepath', undefined)
    expect('filepath' in heard[0]).toBe(true)
    expect(heard[0].remotePath).toBe('media/Series/ep.mp4')
  })

  // Somebody removed the row while the upload ran; it must not come back.
  it('leaves a row that is gone alone', () => {
    const heard: unknown[] = []
    downloader.downloadEvents.on('updated', (i) => heard.push(i))

    downloader.relocateItem('d9', { filepath: join(h.dir, 'x.mp4') })
    expect(downloader.getDownload('d9')).toBeUndefined()
    expect(heard).toEqual([])
  })
})
