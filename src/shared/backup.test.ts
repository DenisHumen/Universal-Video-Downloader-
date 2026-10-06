import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  IMPORT_GRACE_MS,
  backupFileName,
  buildBackup,
  parseBackup,
  planImport,
  type Backup
} from './backup'
import type { AppSettings } from './types'
import type { PipelineStep, SmbTarget, UploadStep, Watch } from './automation'

/*
  Moving to a new computer meant building every watch again by hand. The file
  that saves that has three jobs that must not go wrong: it never carries a
  secret, it never lets a stranger's file write keys settings.json does not
  know, and importing it never downloads an episode that was already handled.
*/

const URL = 'https://yummyani.me/catalog/item/tabakoshka'
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  downloadDir: '/home/demo/Videos',
  keepFinished: 0,
  showAdultServices: false,
  concurrentDownloads: 3,
  defaultMode: 'video',
  defaultQuality: 'best',
  audioFormat: 'mp3',
  embedThumbnail: true,
  embedSubtitles: false,
  embedMetadata: true,
  embedChapters: true,
  writeSubtitles: false,
  subtitleLanguages: 'en,ru',
  sponsorBlock: false,
  restrictFilenames: false,
  preferCompatible: true,
  automationEnabled: false,
  autostart: false,
  smbTargets: [],
  telegramChatId: '',
  logVerbose: false,
  filenameTemplate: '%(title)s [%(id)s].%(ext)s',
  createSubfolders: false,
  speedLimit: '',
  playlistLimit: 500,
  playlistNumbering: true,
  playlistFolder: true,
  autoUpdate: true,
  resumeOnLaunch: true,
  theme: 'night',
  language: 'auto',
  notifications: true,
  clipboardWatch: false,
  trayEnabled: false,
  universalFallback: true,
  proxy: '',
  cookiesFromBrowser: '',
  cookiesFile: '',
  errorReports: 'ask',
  ...over
})

const target = (over: Partial<SmbTarget> = {}): SmbTarget => ({
  id: 't1',
  name: 'nas',
  host: '192.168.1.10',
  share: 'shared',
  path: 'video/series',
  domain: '',
  username: 'demo',
  ...over
})

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  url: URL,
  title: 'Табакошка',
  provider: 'yummyani',
  translatorId: 'dub-a',
  quality: '720p',
  enabled: true,
  intervalMinutes: 360,
  nextCheckAt: 0,
  failures: 0,
  seen: [],
  steps: [{ id: 'd', kind: 'download', enabled: true }],
  createdAt: 1,
  ...over
})

const download: PipelineStep = { id: 'd', kind: 'download', enabled: true }

const upload = (targetId: string, over: Partial<UploadStep> = {}): UploadStep => ({
  id: 'u',
  kind: 'upload',
  enabled: true,
  targetId,
  remotePath: '{title}',
  createDirs: true,
  deleteLocalAfter: true,
  ...over
})

/** A watch added before anything was out, which has no dub yet. */
const waiting = (id: string): Watch => watch({ id, translatorId: '', pending: true })

const backupOf = (over: Partial<Backup> = {}): Backup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  app: '3.24.0',
  exportedAt: new Date(NOW).toISOString(),
  settings: {},
  watches: [],
  smbTargets: [],
  telegram: { chatId: '' },
  ...over
})

/** Through the file and back, the way a real import reads it. */
const viaFile = (backup: Backup): { backup: Backup; invalid: number } => {
  const parsed = parseBackup(JSON.stringify(backup))
  if (!parsed.ok) throw new Error(`refused: ${parsed.error}`)
  return parsed
}

const env = (exists: (path: string) => boolean = () => true) => {
  let n = 0
  return { now: NOW, newId: () => `new-${++n}`, exists }
}

describe('backupFileName', () => {
  it('is dated by the local calendar', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 30))).toBe(
      'universal-video-downloader-backup-2026-01-05.json'
    )
  })
})

describe('buildBackup', () => {
  it('names itself and the app that wrote it', () => {
    const backup = buildBackup({
      settings: settings(),
      watches: [],
      app: '3.24.0',
      now: new Date(NOW)
    })
    expect(backup.format).toBe('uvd-backup')
    expect(backup.version).toBe(1)
    expect(backup.app).toBe('3.24.0')
    expect(backup.exportedAt).toBe('2026-10-06T12:00:00.000Z')
  })

  it('leaves the proxy password out, keeping the user name that says one is needed', () => {
    const backup = buildBackup({
      settings: settings({ proxy: 'http://demo:secret@192.168.1.10:3128' }),
      watches: [],
      app: '3.24.0',
      now: new Date(NOW)
    })
    expect(backup.settings.proxy).toBe('http://demo@192.168.1.10:3128')
    expect(JSON.stringify(backup)).not.toContain('secret')
  })

  it('copies only the fields a share is made of, so a stray password on one stays behind', () => {
    const leaky = { ...target(), password: 'hunter2' } as SmbTarget
    const backup = buildBackup({
      settings: settings({ smbTargets: [leaky], telegramChatId: '100000000' }),
      watches: [],
      app: '3.24.0',
      now: new Date(NOW)
    })
    expect(backup.smbTargets).toEqual([target()])
    expect(backup.telegram).toEqual({ chatId: '100000000' })
    expect(JSON.stringify(backup)).not.toContain('hunter2')
    // The shares and the chat travel on their own, not inside the settings.
    expect(backup.settings).not.toHaveProperty('smbTargets')
    expect(backup.settings).not.toHaveProperty('telegramChatId')
  })

  it('keeps what a watch has handled and drops the record of its last check', () => {
    const backup = buildBackup({
      settings: settings(),
      watches: [
        watch({
          seen: [{ season: 1, episode: 1 }],
          failures: 4,
          lastError: 'offline',
          lastCheckedAt: 5,
          lastRunError: 'share refused',
          lastRunFailedAt: 6,
          attempts: { s1e2: 1 }
        })
      ],
      app: '3.24.0',
      now: new Date(NOW)
    })
    const [kept] = backup.watches
    expect(kept.seen).toEqual([{ season: 1, episode: 1 }])
    expect(kept.failures).toBe(0)
    for (const key of ['lastError', 'lastCheckedAt', 'lastRunError', 'lastRunFailedAt', 'attempts']) {
      expect(kept).not.toHaveProperty(key)
    }
  })
})

describe('parseBackup', () => {
  /** A file holding this, as parseBackup reads it. */
  const read = (value: unknown): ReturnType<typeof parseBackup> => parseBackup(JSON.stringify(value))
  const refused = (error: string): { ok: false; error: string } => ({ ok: false, error })

  it('refuses a file that is not JSON', () => {
    expect(parseBackup('{ not json')).toEqual(refused('json'))
    expect(parseBackup('')).toEqual(refused('json'))
  })

  it('reads a file that a text editor saved with a byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff)
    expect(parseBackup(bom + JSON.stringify(backupOf()))).toMatchObject({ ok: true })
  })

  it('refuses JSON that is not one of ours', () => {
    expect(parseBackup('[]')).toEqual(refused('format'))
    expect(parseBackup('null')).toEqual(refused('format'))
    // The watch list itself, picked by mistake.
    expect(read({ watches: [], runs: {} })).toEqual(refused('format'))
    expect(read({ ...backupOf(), format: 'other-app' })).toEqual(refused('format'))
  })

  it('refuses a version that is missing or not a version', () => {
    for (const version of [undefined, 0, -1, 1.5, '1']) {
      expect(read({ ...backupOf(), version })).toEqual(refused('format'))
    }
  })

  it('refuses a backup from a newer build rather than half-reading it', () => {
    expect(read({ ...backupOf(), version: BACKUP_VERSION + 1 })).toEqual(refused('version'))
  })

  it('refuses sections that are the wrong kind of thing altogether', () => {
    expect(read({ ...backupOf(), settings: [] })).toEqual(refused('shape'))
    expect(read({ ...backupOf(), watches: {} })).toEqual(refused('shape'))
    expect(read({ ...backupOf(), smbTargets: 'nas' })).toEqual(refused('shape'))
    expect(read({ ...backupOf(), telegram: 'chat' })).toEqual(refused('shape'))
  })

  it('reads a backup with sections missing as an empty one', () => {
    const parsed = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }))
    expect(parsed).toMatchObject({ ok: true, invalid: 0 })
    if (parsed.ok) {
      expect(parsed.backup.settings).toEqual({})
      expect(parsed.backup.watches).toEqual([])
      expect(parsed.backup.smbTargets).toEqual([])
      expect(parsed.backup.telegram).toEqual({ chatId: '' })
    }
  })

  it('takes only settings it knows, of the right kind', () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backupOf(),
        settings: {
          theme: 'day',
          notifications: 'yes',
          language: 'klingon',
          concurrentDownloads: 5,
          defaultQuality: '1080',
          cookiesFromBrowser: 'netscape',
          injected: 'x'
        }
      })
    )
    expect(parsed.ok && parsed.backup.settings).toEqual({
      theme: 'day',
      concurrentDownloads: 5,
      defaultQuality: '1080'
    })
  })

  it('does not let a crafted key reach anything', () => {
    const parsed = parseBackup(
      '{"format":"uvd-backup","version":1,"settings":{"__proto__":{"polluted":true},"theme":"day"}}'
    )
    expect(parsed.ok && parsed.backup.settings).toEqual({ theme: 'day' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('strips a proxy password from a hand-edited file as well', () => {
    const parsed = parseBackup(
      JSON.stringify({ ...backupOf(), settings: { proxy: 'socks5://demo:secret@192.168.1.10:1080' } })
    )
    expect(parsed.ok && parsed.backup.settings.proxy).toBe('socks5://demo@192.168.1.10:1080')
  })

  it('drops a damaged watch on its own, counts it, and keeps the rest', () => {
    const parsed = parseBackup(
      JSON.stringify({ ...backupOf(), watches: [watch(), { title: 'no url' }, 'nonsense', null] })
    )
    expect(parsed).toMatchObject({ ok: true, invalid: 3 })
    expect(parsed.ok && parsed.backup.watches.map((w) => w.id)).toEqual(['w1'])
  })

  it('rebuilds a watch from known fields only', () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backupOf(),
        watches: [
          {
            ...watch(),
            extra: 'not ours',
            seen: [{ season: 1, episode: 1 }, { season: 1, episode: 1 }, { season: 'x' }, 7],
            steps: [
              { id: 'u', kind: 'upload', enabled: true, targetId: 't1', remotePath: '{title}' },
              { id: 'f', kind: 'from-a-newer-build', enabled: true },
              { id: 'd', kind: 'download', enabled: true }
            ]
          }
        ]
      })
    )
    if (!parsed.ok) throw new Error('refused')
    const [w] = parsed.backup.watches
    expect(w).not.toHaveProperty('extra')
    expect(w.seen).toEqual([{ season: 1, episode: 1 }])
    expect(w.steps.map((s) => s.kind)).toEqual(['download', 'upload'])
    // A damaged entry is not a reason for files to vanish.
    expect(w.steps[1]).toMatchObject({ kind: 'upload', createDirs: true, deleteLocalAfter: false })
  })

  it('drops a share with no server, after the repair that can find one in the share box', () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backupOf(),
        smbTargets: [
          target(),
          { id: 'x', share: 'nowhere' },
          5,
          { id: 'old', name: 'old', host: '', share: '//192.168.1.20/shared/video' }
        ]
      })
    )
    expect(parsed.ok && parsed.backup.smbTargets).toEqual([
      target(),
      target({ id: 'old', name: 'old', host: '192.168.1.20', path: 'video', username: '' })
    ])
  })

  it('reads back exactly what was written', () => {
    const written = buildBackup({
      settings: settings({ theme: 'day', smbTargets: [target()], telegramChatId: '100000000' }),
      watches: [
        watch({
          seen: [{ season: 1, episode: 1 }],
          steps: [
            { id: 'd', kind: 'download', enabled: true },
            {
              id: 'r',
              kind: 'rename',
              enabled: true,
              template: '{title} - E{episode2}',
              replacements: [{ from: 'а', to: 'a' }]
            },
            upload('t1'),
            { id: 'n', kind: 'notify', enabled: false }
          ]
        })
      ],
      app: '3.24.0',
      now: new Date(NOW)
    })
    expect(viaFile(written)).toMatchObject({ backup: written, invalid: 0 })
    expect(viaFile(written).backup).toEqual(written)
  })
})

describe('planImport: settings', () => {
  it('applies the settings from the file', () => {
    const plan = planImport(
      viaFile(backupOf({ settings: { theme: 'day', downloadDir: '/media/videos' } })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.settings).toEqual({ theme: 'day', downloadDir: '/media/videos' })
    expect(plan.counts).toMatchObject({ settings: true, folderKept: false })
  })

  it('keeps the current download folder when the backup names one this machine does not have', () => {
    const plan = planImport(
      viaFile(backupOf({ settings: { theme: 'day', downloadDir: 'D:\\Old PC\\Videos' } })),
      { settings: settings(), watches: [] },
      env((path) => path !== 'D:\\Old PC\\Videos')
    )
    expect(plan.settings).not.toHaveProperty('downloadDir')
    expect(plan.settings.theme).toBe('day')
    expect(plan.counts.folderKept).toBe(true)
  })

  it('keeps the current cookies file when the backup names a missing one', () => {
    const plan = planImport(
      viaFile(backupOf({ settings: { cookiesFile: '/old/cookies.txt' } })),
      { settings: settings({ cookiesFile: '/home/demo/cookies.txt' }), watches: [] },
      env((path) => path !== '/old/cookies.txt')
    )
    expect(plan.settings).not.toHaveProperty('cookiesFile')
  })

  it('says nothing changed when the file holds what is already here', () => {
    const current = settings({ theme: 'day' })
    const backup = buildBackup({ settings: current, watches: [], app: '3.24.0', now: new Date(NOW) })
    const plan = planImport(viaFile(backup), { settings: current, watches: [] }, env())
    expect(plan.counts.settings).toBe(false)
  })

  it('sets the Telegram chat from the file, and leaves it alone when the file has none', () => {
    const named = planImport(
      viaFile(backupOf({ telegram: { chatId: '100000000' } })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(named.settings.telegramChatId).toBe('100000000')
    expect(named.counts.settings).toBe(true)

    const blank = planImport(
      viaFile(backupOf()),
      { settings: settings({ telegramChatId: '100000001' }), watches: [] },
      env()
    )
    expect(blank.settings).not.toHaveProperty('telegramChatId')
  })

  it('says a proxy that signs in needs its password again, since the file never has it', () => {
    const plan = planImport(
      viaFile(backupOf({ settings: { proxy: 'http://demo:secret@192.168.1.10:3128' } })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.settings.proxy).toBe('http://demo@192.168.1.10:3128')
    expect(plan.counts).toMatchObject({ settings: true, proxyPassword: true })
  })

  it('does not ask for a password a proxy without a user name never sends', () => {
    const plan = planImport(
      viaFile(backupOf({ settings: { proxy: 'socks5://192.168.1.10:1080' } })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.settings.proxy).toBe('socks5://192.168.1.10:1080')
    expect(plan.counts.proxyPassword).toBe(false)

    const cleared = planImport(
      viaFile(backupOf({ settings: { proxy: '' } })),
      { settings: settings({ proxy: 'http://demo@192.168.1.10:3128' }), watches: [] },
      env()
    )
    expect(cleared.settings.proxy).toBe('')
    expect(cleared.counts.proxyPassword).toBe(false)
  })

  it('leaves the proxy in use alone, password and all, when the file names the same one', () => {
    // A system with no key store keeps the password inside the address.
    const inline = 'http://demo:secret@192.168.1.10:3128'
    const current = settings({ proxy: inline })
    const backup = buildBackup({ settings: current, watches: [], app: '3.24.0', now: new Date(NOW) })
    const plan = planImport(viaFile(backup), { settings: current, watches: [] }, env())
    expect(plan.settings).not.toHaveProperty('proxy')
    expect(plan.counts).toMatchObject({ settings: false, proxyPassword: false })

    // With a key store the address here already has no password, and the stored one stays.
    const stored = settings({ proxy: 'http://demo@192.168.1.10:3128' })
    const again = planImport(viaFile(backup), { settings: stored, watches: [] }, env())
    expect(again.settings).not.toHaveProperty('proxy')
    expect(again.counts.proxyPassword).toBe(false)
  })
})

describe('planImport: shares', () => {
  it('adds the shares this machine does not have, without passwords', () => {
    const plan = planImport(
      viaFile(backupOf({ smbTargets: [target()] })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.settings.smbTargets).toEqual([target()])
    expect(plan.counts.targetsAdded).toBe(1)
    // A share alone is not a changed setting.
    expect(plan.counts.settings).toBe(false)
  })

  it('reuses a share that is already here, and points the imported uploads at it', () => {
    const local = target({ id: 'local', name: 'my nas', host: '192.168.1.10', path: 'Video\\Series' })
    const plan = planImport(
      viaFile(
        backupOf({
          smbTargets: [target({ id: 'remote', host: '192.168.1.10' })],
          watches: [
            watch({
              steps: [download, upload('remote')]
            })
          ]
        })
      ),
      { settings: settings({ smbTargets: [local] }), watches: [] },
      env()
    )
    expect(plan.counts.targetsAdded).toBe(0)
    expect(plan.settings).not.toHaveProperty('smbTargets')
    expect(plan.watches[0].steps[1]).toMatchObject({ kind: 'upload', targetId: 'local' })
  })

  it('gives an imported share a new id when its id is taken by a different one', () => {
    const plan = planImport(
      viaFile(
        backupOf({
          smbTargets: [target({ id: 'same', host: '192.168.1.20' })],
          watches: [
            watch({
              steps: [upload('same', { deleteLocalAfter: false })]
            })
          ]
        })
      ),
      {
        settings: settings({ smbTargets: [target({ id: 'same', host: '192.168.1.10' })] }),
        watches: []
      },
      env()
    )
    const added = plan.settings.smbTargets?.[1]
    expect(added).toMatchObject({ host: '192.168.1.20' })
    expect(added?.id).not.toBe('same')
    expect(plan.watches[0].steps[0]).toMatchObject({ targetId: added?.id })
  })
})

describe('planImport: watches', () => {
  it('adds a watch with what it has handled, under a fresh id, with its last check forgotten', () => {
    const plan = planImport(
      viaFile(
        backupOf({
          watches: [
            watch({
              seen: [
                { season: 1, episode: 1 },
                { season: 1, episode: 2 }
              ]
            })
          ]
        })
      ),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.counts).toMatchObject({ watchesAdded: 1, watchesSkipped: 0 })
    const [w] = plan.watches
    expect(w.id).toBe('new-1')
    expect(w.seen).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 }
    ])
    expect(w.failures).toBe(0)
    expect(w.createdAt).toBe(1)
  })

  it('checks a download-only watch at once, and gives one that needs a password time to get it', () => {
    const plan = planImport(
      viaFile(
        backupOf({
          watches: [
            watch({ id: 'plain', url: `${URL}-1` }),
            watch({
              id: 'uploads',
              url: `${URL}-2`,
              steps: [download, upload('t1')]
            }),
            watch({
              id: 'tells',
              url: `${URL}-3`,
              steps: [
                { id: 'd', kind: 'download', enabled: true },
                { id: 'n', kind: 'notify', enabled: true }
              ]
            }),
            watch({
              id: 'disabled-notify',
              url: `${URL}-4`,
              steps: [
                { id: 'd', kind: 'download', enabled: true },
                { id: 'n', kind: 'notify', enabled: false }
              ]
            })
          ]
        })
      ),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.watches.map((w) => w.nextCheckAt)).toEqual([
      NOW,
      NOW + IMPORT_GRACE_MS,
      NOW + IMPORT_GRACE_MS,
      NOW
    ])
  })

  it('skips a series and dub already watched here, at any quality', () => {
    const plan = planImport(
      viaFile(backupOf({ watches: [watch({ quality: '1080p' })] })),
      { settings: settings(), watches: [watch({ id: 'here', url: `${URL}/?utm_source=x` })] },
      env()
    )
    expect(plan.counts).toMatchObject({ watchesAdded: 0, watchesSkipped: 1 })
  })

  it('adds the same series in another dub', () => {
    const plan = planImport(
      viaFile(backupOf({ watches: [watch({ translatorId: 'dub-b' })] })),
      { settings: settings(), watches: [watch({ id: 'here' })] },
      env()
    )
    expect(plan.counts.watchesAdded).toBe(1)
  })

  it('restores two qualities of one series from the same backup, but not an exact copy', () => {
    const plan = planImport(
      viaFile(
        backupOf({
          watches: [
            watch({ id: 'a', quality: '720p' }),
            watch({ id: 'b', quality: '1080p' }),
            watch({ id: 'c', quality: '720p' })
          ]
        })
      ),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.watches.map((w) => w.quality)).toEqual(['720p', '1080p'])
    expect(plan.counts.watchesSkipped).toBe(1)
  })

  it('skips a waiting watch for a title already watched here in any dub', () => {
    const plan = planImport(
      viaFile(backupOf({ watches: [waiting('p1'), waiting('p2')] })),
      { settings: settings(), watches: [watch({ id: 'here', translatorId: 'dub-z' })] },
      env()
    )
    expect(plan.counts).toMatchObject({ watchesAdded: 0, watchesSkipped: 2 })
  })

  it('adds a waiting watch once', () => {
    const plan = planImport(
      viaFile(backupOf({ watches: [waiting('p1'), waiting('p2')] })),
      { settings: settings(), watches: [] },
      env()
    )
    expect(plan.counts).toMatchObject({ watchesAdded: 1, watchesSkipped: 1 })
    expect(plan.watches[0].pending).toBe(true)
  })

  it('also counts as seen what a watch here on the same series and dub has handled', () => {
    const plan = planImport(
      viaFile(backupOf({ watches: [watch({ quality: '1080p', seen: [{ season: 1, episode: 1 }] })] })),
      {
        settings: settings(),
        watches: [watch({ id: 'other-dub', translatorId: 'dub-b', seen: [{ season: 1, episode: 5 }] })]
      },
      env()
    )
    // Another dub's episodes are not this one's.
    expect(plan.watches[0].seen).toEqual([{ season: 1, episode: 1 }])
  })

  it('changes nothing the second time the same backup is imported', () => {
    const backup = viaFile(
      backupOf({
        smbTargets: [target()],
        watches: [watch({ id: 'a' }), watch({ id: 'b', quality: '1080p' })]
      })
    )
    const first = planImport(backup, { settings: settings(), watches: [] }, env())
    const second = planImport(
      backup,
      { settings: settings({ smbTargets: first.settings.smbTargets ?? [] }), watches: first.watches },
      env()
    )
    expect(second.counts).toMatchObject({ watchesAdded: 0, watchesSkipped: 2, targetsAdded: 0 })
  })

  it('reports damaged entries the file held', () => {
    const parsed = parseBackup(JSON.stringify({ ...backupOf(), watches: [watch(), { url: 'x' }] }))
    if (!parsed.ok) throw new Error('refused')
    expect(planImport(parsed, { settings: settings(), watches: [] }, env()).counts).toMatchObject({
      watchesAdded: 1,
      watchesInvalid: 1
    })
  })
})
