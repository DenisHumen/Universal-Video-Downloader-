import { describe, expect, it } from 'vitest'
import { isSafeTemplate, liftProxyPassword, migrate, type ProxyPasswordStore } from './settings'

/*
  `migrate` runs on the first launch after every update, for every existing
  user, and its caller swallows anything it throws by resetting the whole
  configuration to defaults. It had no tests.
*/

describe('migrate', () => {
  it('maps a palette that no longer exists onto the nearest survivor', () => {
    // Somebody who chose `daylight` wants a light window, not a reset.
    expect(migrate({ theme: 'daylight' }).theme).toBe('day')
    expect(migrate({ theme: 'midnight' }).theme).toBe('night')
    expect(migrate({ theme: 'carbon' }).theme).toBe('night')
    expect(migrate({ theme: 'nebula' }).theme).toBe('night')
  })

  it('leaves a palette that still exists alone', () => {
    expect(migrate({ theme: 'day' }).theme).toBe('day')
    expect(migrate({ theme: 'night' }).theme).toBe('night')
  })

  it('falls back to night for a theme nobody has ever heard of', () => {
    expect(migrate({ theme: 'chartreuse' }).theme).toBe('night')
  })

  it('drops the accent that the redesign removed', () => {
    expect('accent' in migrate({ accent: 'violet' })).toBe(false)
  })

  it('clamps the numbers a hand-edited file could put out of range', () => {
    expect(migrate({ concurrentDownloads: 99 }).concurrentDownloads).toBe(8)
    expect(migrate({ concurrentDownloads: 0 }).concurrentDownloads).toBe(1)
    expect(migrate({ concurrentDownloads: 2.6 }).concurrentDownloads).toBe(3)
    expect(migrate({ playlistLimit: 99999 }).playlistLimit).toBe(5000)
    expect(migrate({ playlistLimit: 1 }).playlistLimit).toBe(10)
  })

  it('passes everything else through untouched', () => {
    const raw = { downloadDir: 'D:\\Videos', proxy: 'http://p:8080', cookiesFile: 'c.txt' }
    expect(migrate(raw)).toMatchObject(raw)
  })

  it('repairs an error-report choice it does not recognise, and only that', () => {
    expect(migrate({ errorReports: 'always' }).errorReports).toBe('ask')
    expect(migrate({ errorReports: 'off' }).errorReports).toBe('off')
    // A partial save of some other setting must not switch reports back on.
    expect('errorReports' in migrate({ theme: 'day' })).toBe(false)
  })

  it('replaces a filename template that would write outside the folder', () => {
    expect(migrate({ filenameTemplate: '../../evil.%(ext)s' }).filenameTemplate).toBe(
      '%(title)s [%(id)s].%(ext)s'
    )
  })

  it('repairs a speed limit an older build saved as typed', () => {
    // A stored "2MB" made every download stop with an engine usage error.
    expect(migrate({ speedLimit: '2MB' }).speedLimit).toBe('2M')
    expect(migrate({ speedLimit: '1,5 Мб/с' }).speedLimit).toBe('1.5M')
    expect(migrate({ speedLimit: '500K' }).speedLimit).toBe('500K')
  })

  it('lifts a speed limit that cannot be read rather than keep failing on it', () => {
    expect(migrate({ speedLimit: 'fast' }).speedLimit).toBe('')
    expect(migrate({ speedLimit: '500' }).speedLimit).toBe('')
    // A hand-edited number would have thrown in the downloader's `.trim()`.
    expect(migrate({ speedLimit: 500 }).speedLimit).toBe('')
  })

  it('leaves the speed limit alone when a write does not touch it', () => {
    // setSettings runs every partial through here; most of them are about something else.
    expect('speedLimit' in migrate({ theme: 'day' })).toBe(false)
  })

  it('reads a finished-row limit it cannot make sense of as no limit at all', () => {
    // A bad value must never start deleting history.
    expect(migrate({ keepFinished: 'lots' }).keepFinished).toBe(0)
    expect(migrate({ keepFinished: -3 }).keepFinished).toBe(0)
    expect(migrate({ keepFinished: null }).keepFinished).toBe(0)
    expect(migrate({ keepFinished: 0 }).keepFinished).toBe(0)
  })

  it('holds a finished-row limit to a sane range', () => {
    expect(migrate({ keepFinished: 3 }).keepFinished).toBe(10)
    expect(migrate({ keepFinished: 500 }).keepFinished).toBe(500)
    expect(migrate({ keepFinished: 99999 }).keepFinished).toBe(10000)
    expect('keepFinished' in migrate({ theme: 'day' })).toBe(false)
  })

  // Normalising `null` threw, and a throw here reset every other setting too.
  it('drops a share entry that is not a share at all', () => {
    const share = { id: 's', name: 'NAS', host: 'nas', share: 'media', path: '', domain: '', username: '' }
    const targets = migrate({ smbTargets: [null, 'nas', share] }).smbTargets
    expect(targets).toHaveLength(1)
    expect(targets?.[0]).toMatchObject({ id: 's', host: 'nas' })
  })
})

describe('isSafeTemplate', () => {
  it('accepts the shapes people actually use', () => {
    expect(isSafeTemplate('%(title)s [%(id)s].%(ext)s')).toBe(true)
    // Per-uploader subfolders are a real thing, and stay inside the folder.
    expect(isSafeTemplate('%(uploader)s/%(title)s.%(ext)s')).toBe(true)
    expect(isSafeTemplate('')).toBe(true)
  })

  it('refuses to climb out of the download folder', () => {
    expect(isSafeTemplate('../%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('a/../../b/%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('a\\..\\..\\b.%(ext)s')).toBe(false)
  })

  it('refuses an absolute path, which would discard the folder entirely', () => {
    expect(isSafeTemplate('C:\\Windows\\System32\\%(title)s.%(ext)s')).toBe(false)
    expect(isSafeTemplate('/etc/cron.d/%(title)s')).toBe(false)
    expect(isSafeTemplate('\\\\server\\share\\%(title)s.%(ext)s')).toBe(false)
  })

  it('is not fooled by a name that merely contains two dots', () => {
    expect(isSafeTemplate('%(title)s..%(ext)s')).toBe(true)
    expect(isSafeTemplate('season..2/%(title)s.%(ext)s')).toBe(true)
  })
})

/*
  A share saved before the path box existed keeps the whole path in its share
  field, which no server accepts. It was reported from a real settings file, so
  the repair has to happen on the read, not only in the form.
*/
describe('migrate, for shares saved by an older version', () => {
  const stored = {
    id: 'x',
    name: 'downloads',
    host: '192.168.1.10',
    share: '\\shared\\torrents\\downloads\\',
    domain: '',
    username: 'someone'
  }

  it('splits the path back out of the share field on read', () => {
    const [fixed] = migrate({ smbTargets: [stored] }).smbTargets ?? []
    expect(fixed).toMatchObject({ host: '192.168.1.10', share: 'shared', path: 'torrents/downloads' })
  })

  it('keeps the id, so the password already stored against it still applies', () => {
    const [fixed] = migrate({ smbTargets: [stored] }).smbTargets ?? []
    expect(fixed.id).toBe('x')
    expect(fixed.name).toBe('downloads')
  })

  it('relabels a share still wearing the old generated name', () => {
    // The renderer draws this straight from the store, so the repair has to
    // reach it here - the settings read is the only thing between the file and
    // the list the user is looking at.
    const generated = { ...stored, name: '192.168.1.10/shared\\torrents\\downloads' }
    const [fixed] = migrate({ smbTargets: [generated] }).smbTargets ?? []
    expect(fixed.name).toBe('\\\\192.168.1.10\\shared\\torrents\\downloads')
  })

  it('leaves a name the user chose alone', () => {
    const [fixed] = migrate({ smbTargets: [stored] }).smbTargets ?? []
    expect(fixed.name).toBe('downloads')
  })

  it('leaves settings without any shares untouched', () => {
    expect(migrate({ theme: 'day' }).smbTargets).toBeUndefined()
    expect(migrate({ smbTargets: [] }).smbTargets).toEqual([])
  })
})

/*
  The proxy setting held its password in plain text: in settings.json, which
  people attach to bug reports, and on every engine command line. It moves to
  the secret store on the first read of this version and on every save.
*/
describe('liftProxyPassword', () => {
  function store(persists = true): ProxyPasswordStore & { kept: string[]; forgotten: number } {
    const box = {
      kept: [] as string[],
      forgotten: 0,
      keep: (password: string): boolean => {
        if (!persists) return false
        box.kept.push(password)
        return true
      },
      forget: (): void => {
        box.forgotten++
      }
    }
    return box
  }

  it('moves the password of a stored proxy to the secret store and keeps the user', () => {
    const box = store()
    const next = liftProxyPassword(migrate({ proxy: 'http://user:p%40ss@host:8080' }), box)
    expect(box.kept).toEqual(['p@ss'])
    expect(next.proxy).toBe('http://user@host:8080')
  })

  it('catches a password pasted into the field, bare address included', () => {
    const box = store()
    expect(liftProxyPassword({ proxy: 'user:secret@proxy.example.com:3128' }, box).proxy).toBe(
      'user@proxy.example.com:3128'
    )
    expect(box.kept).toEqual(['secret'])
  })

  it('leaves a proxy without a password exactly as it was', () => {
    const box = store()
    const settings = { proxy: 'http://user@192.168.1.10:8080' }
    expect(liftProxyPassword(settings, box)).toBe(settings)
    expect(box.kept).toEqual([])
    expect(box.forgotten).toBe(0)
  })

  it('keeps the password in the address when there is nowhere it would survive a restart', () => {
    // Moving it to memory would turn every download away after the next launch.
    const box = store(false)
    const settings = { proxy: 'http://user:pass@192.168.1.10:8080' }
    expect(liftProxyPassword(settings, box)).toBe(settings)
  })

  it('forgets the stored password once the address has no user', () => {
    // It is never sent without one, and a leftover would follow the next user typed.
    const box = store()
    expect(liftProxyPassword({ proxy: 'http://192.168.1.10:8080' }, box).proxy).toBe(
      'http://192.168.1.10:8080'
    )
    expect(liftProxyPassword({ proxy: '' }, box).proxy).toBe('')
    expect(box.forgotten).toBe(2)
  })

  it('passes settings without a proxy field through, as a partial save has none', () => {
    const box = store()
    const partial = migrate({ theme: 'day' })
    expect(liftProxyPassword(partial, box)).toBe(partial)
    expect(box.forgotten).toBe(0)
  })
})
