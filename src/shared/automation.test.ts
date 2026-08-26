import { describe, expect, it } from 'vitest'
import {
  applyReplacements,
  formatSmbPath,
  normaliseSmbTarget,
  episodeKey,
  fillTemplate,
  parseSmbPath,
  newEpisodes,
  remoteDirFor,
  renameFor,
  safeSegment,
  type RenameStep
} from './automation'

const AT = new Date(2026, 7, 25)

const step = (over: Partial<RenameStep> = {}): RenameStep => ({
  id: 'r',
  kind: 'rename',
  enabled: true,
  template: '{title} - S{season2}E{episode2}',
  replacements: [],
  ...over
})

describe('applyReplacements', () => {
  it('renames a series into whatever the user files it under', () => {
    // The sites this watches answer in Russian; a library organised in English
    // is the whole reason this module exists.
    expect(applyReplacements('Табакошка', [{ from: 'Табакошка', to: 'Tabakoshka' }])).toBe(
      'Tabakoshka'
    )
  })

  it('replaces every occurrence, not just the first', () => {
    expect(applyReplacements('a b a b', [{ from: 'a', to: 'x' }])).toBe('x b x b')
  })

  it('applies rules in the order they are listed', () => {
    const rules = [
      { from: 'one', to: 'two' },
      { from: 'two', to: 'three' }
    ]
    expect(applyReplacements('one', rules)).toBe('three')
  })

  it('takes the text literally rather than as a pattern', () => {
    // Somebody naming a TV show should not have to know what `(` means.
    expect(applyReplacements('Show (2025)', [{ from: '(2025)', to: '' }])).toBe('Show ')
    expect(applyReplacements('a.b', [{ from: '.', to: '-' }])).toBe('a-b')
  })

  it('ignores a rule with nothing to find', () => {
    expect(applyReplacements('Show', [{ from: '', to: 'X' }])).toBe('Show')
  })
})

describe('fillTemplate', () => {
  const values = { title: 'Show', season: 1, episode: 9, quality: '720p', ext: 'mkv' }

  it('fills the tokens', () => {
    expect(fillTemplate('{title} S{season}E{episode} {quality}.{ext}', values, AT)).toBe(
      'Show S1E9 720p.mkv'
    )
  })

  it('pads the two-digit forms', () => {
    expect(fillTemplate('S{season2}E{episode2}', values, AT)).toBe('S01E09')
  })

  it('does not pad past two digits', () => {
    expect(fillTemplate('E{episode2}', { ...values, episode: 128 }, AT)).toBe('E128')
  })

  it('leaves an unknown token visible instead of silently dropping it', () => {
    // A typo should look like a typo, not produce "Show - S01E" and a mystery.
    expect(fillTemplate('{title} {epsiode}', values, AT)).toBe('Show {epsiode}')
  })

  it('takes the date from the clock it is given', () => {
    expect(fillTemplate('{year} {date}', values, AT)).toBe('2026 2026-08-25')
  })
})

describe('safeSegment', () => {
  it('removes what no filesystem will take', () => {
    expect(safeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe('a b c d e f g h i j')
  })

  it('keeps hyphens, because that is what people put in their templates', () => {
    expect(safeSegment('Show - S01E09')).toBe('Show - S01E09')
  })

  it('trims the dots and spaces Windows refuses at the end of a name', () => {
    expect(safeSegment('  Show.  ')).toBe('Show')
  })

  it('keeps a title readable rather than truncating mid-word forever', () => {
    expect(safeSegment('x'.repeat(400)).length).toBe(180)
  })
})

describe('renameFor', () => {
  const values = { title: 'Табакошка', season: 1, episode: 9, quality: '720p', ext: 'mkv' }

  it('builds the filename people actually want', () => {
    const s = step({ replacements: [{ from: 'Табакошка', to: 'Tabakoshka' }] })
    expect(renameFor(s, values, AT)).toBe('Tabakoshka - S01E09.mkv')
  })

  it('keeps the extension it was given, however it was written', () => {
    expect(renameFor(step(), { ...values, ext: '.mp4' }, AT)).toMatch(/[.]mp4$/)
  })

  it('never produces a nameless file', () => {
    expect(renameFor(step({ template: '///' }), values, AT)).toBe('episode.mkv')
  })

  it('cannot be made to escape its directory by a hostile title', () => {
    const out = renameFor(step({ template: '{title}' }), { ...values, title: '../../etc/passwd' }, AT)
    expect(out).not.toContain('/')
    expect(out).not.toContain('..')
  })
})

describe('remoteDirFor', () => {
  const values = { title: 'Tabakoshka', season: 1, episode: 9 }

  it('keeps slashes as directory levels, which is the point of the field', () => {
    expect(remoteDirFor('anime/{title}/season {season}', values, [], AT)).toBe(
      'anime/Tabakoshka/season 1'
    )
  })

  it('does not let a title invent a level of its own', () => {
    expect(remoteDirFor('{title}', { ...values, title: 'a/b' }, [], AT)).toBe('a b')
  })

  it('drops empty levels rather than producing a doubled slash', () => {
    expect(remoteDirFor('a//{title}', values, [], AT)).toBe('a/Tabakoshka')
  })

  it('runs the replacements first, so one set of rules serves both', () => {
    expect(remoteDirFor('{title}', { ...values, title: 'Табакошка' }, [
      { from: 'Табакошка', to: 'Tabakoshka' }
    ], AT)).toBe('Tabakoshka')
  })
})

describe('newEpisodes', () => {
  const ep = (season: number, episode: number): { season: number; episode: number } => ({
    season,
    episode
  })

  it('finds what has appeared since last time', () => {
    const seen = [ep(1, 1), ep(1, 2)]
    expect(newEpisodes(seen, [ep(1, 1), ep(1, 2), ep(1, 3)])).toEqual([ep(1, 3)])
  })

  it('has nothing to do when nothing has changed', () => {
    expect(newEpisodes([ep(1, 1)], [ep(1, 1)])).toEqual([])
  })

  /*
    The reason `seen` is a set of pairs and not the highest episode number:
    sites really do add an episode behind one already published, and a
    high-water mark would never look back.
  */
  it('notices an episode inserted behind ones already handled', () => {
    const seen = [ep(1, 1), ep(1, 3)]
    expect(newEpisodes(seen, [ep(1, 1), ep(1, 2), ep(1, 3)])).toEqual([ep(1, 2)])
  })

  it('treats the same number in another season as another episode', () => {
    expect(newEpisodes([ep(1, 1)], [ep(1, 1), ep(2, 1)])).toEqual([ep(2, 1)])
  })

  it('returns them in the order they should be downloaded', () => {
    expect(newEpisodes([], [ep(2, 1), ep(1, 5), ep(1, 2)])).toEqual([
      ep(1, 2),
      ep(1, 5),
      ep(2, 1)
    ])
  })

  it('is not upset by an episode disappearing from the site', () => {
    expect(newEpisodes([ep(1, 1), ep(1, 2)], [ep(1, 1)])).toEqual([])
  })
})

describe('episodeKey', () => {
  it('tells seasons apart', () => {
    expect(episodeKey({ season: 1, episode: 12 })).not.toBe(episodeKey({ season: 11, episode: 2 }))
  })
})

/**
 * Reading the location people actually write.
 *
 * The share box was first offered on its own, and the first thing it received
 * was a whole path - which the server answers with "there is no share by that
 * name", because a share really is only the first segment. Every spelling below
 * is one somebody has reasonably typed, and all of them mean the same place.
 */
describe('parseSmbPath', () => {
  const path = '\\\\192.168.1.10\\shared\\torrents\\downloads'
  const messy = '\\\\192.168.1.10\\\\shared\\torrents\\downloads\\'

  it('splits a UNC path into server, share and folder', () => {
    expect(parseSmbPath(path)).toEqual({
      host: '192.168.1.10',
      share: 'shared',
      folder: 'torrents/downloads'
    })
  })

  it('reads every other spelling of the same place the same way', () => {
    const expected = { host: '192.168.1.10', share: 'shared', folder: 'torrents/downloads' }
    expect(parseSmbPath('//192.168.1.10/shared/torrents/downloads')).toEqual(expected)
    expect(parseSmbPath('smb://192.168.1.10/shared/torrents/downloads')).toEqual(expected)
    expect(parseSmbPath('192.168.1.10/shared/torrents/downloads')).toEqual(expected)
    expect(parseSmbPath(messy)).toEqual(expected)
    expect(parseSmbPath('  ' + path + '  ')).toEqual(expected)
  })

  it('keeps the share to one segment however deep the path goes', () => {
    // This is the whole point: the second segment is the share, and everything
    // past it is a folder the upload creates rather than part of the name.
    expect(parseSmbPath(path).share).toBe('shared')
    expect(parseSmbPath('\\\\192.168.1.10\\shared')).toEqual({ host: '192.168.1.10', share: 'shared', folder: '' })
  })

  it('reports missing parts as empty rather than guessing', () => {
    expect(parseSmbPath('')).toEqual({ host: '', share: '', folder: '' })
    expect(parseSmbPath('192.168.1.10')).toEqual({ host: '192.168.1.10', share: '', folder: '' })
    // A path with no server names a share nowhere, so the first segment is read
    // as the host regardless. An obviously wrong server in the readout under the
    // box is easier to spot and correct than a silently invented one.
    expect(parseSmbPath('\\shared\\torrents\\downloads\\').host).toBe('shared')
  })

  it('writes a location back the way it came in', () => {
    expect(formatSmbPath(parseSmbPath(path))).toBe(path)
    expect(formatSmbPath(parseSmbPath(messy))).toBe(path)
    expect(formatSmbPath({ host: '', share: '', folder: '' })).toBe('')
  })
})

/**
 * Repairing shares that were saved before the path box existed.
 *
 * This is the case that was actually reported: a share stored as
 * "shared/torrents/downloads" at the root of nothing, which the server answers
 * with "there is no share by that name" no matter how good the form in front
 * of it has become.
 */
describe('normaliseSmbTarget', () => {
  const base = {
    id: 'x',
    name: 'the one from the bug report',
    host: '192.168.1.10',
    share: '',
    path: '',
    domain: '',
    username: 'someone'
  }

  it('splits a share that swallowed the rest of the path', () => {
    const fixed = normaliseSmbTarget({ ...base, share: '\\shared\\torrents\\downloads\\' })
    expect(fixed.share).toBe('shared')
    expect(fixed.path).toBe('torrents/downloads')
    expect(fixed.host).toBe('192.168.1.10')
  })

  it('does not name the server twice when the share held a whole UNC path', () => {
    const fixed = normaliseSmbTarget({ ...base, share: '\\\\192.168.1.10\\shared\\torrents\\downloads' })
    expect(fixed).toMatchObject({ host: '192.168.1.10', share: 'shared', path: 'torrents/downloads' })
  })

  it('takes the server from the share when the server box was left empty', () => {
    const fixed = normaliseSmbTarget({ ...base, host: '', share: '\\\\192.168.1.10\\shared\\torrents\\downloads' })
    expect(fixed).toMatchObject({ host: '192.168.1.10', share: 'shared', path: 'torrents/downloads' })
  })

  it('leaves a target that was already right alone', () => {
    const good = { ...base, share: 'shared', path: 'torrents/downloads' }
    expect(normaliseSmbTarget(good)).toEqual(good)
  })

  it('gives a path rather than undefined for a target saved before the field existed', () => {
    // Written out in full, without the field at all - which is how an older
    // settings file really holds it, and what the app reads back.
    const old = {
      id: 'x',
      name: 'saved before the field existed',
      host: '192.168.1.10',
      share: 'shared',
      domain: '',
      username: 'someone'
    } as unknown as typeof base
    expect(normaliseSmbTarget(old).path).toBe('')
  })

  it('repairs the same target to the same thing however often it runs', () => {
    // It runs on every settings read and write, so drifting would compound.
    const once = normaliseSmbTarget({ ...base, share: '\\shared\\torrents\\downloads\\' })
    expect(normaliseSmbTarget(once)).toEqual(once)
    expect(normaliseSmbTarget(normaliseSmbTarget(once))).toEqual(once)
  })

  it('relabels a share still wearing the old generated name', () => {
    const share = '\\shared\\torrents\\downloads\\'
    const generated = { ...base, share, name: `192.168.1.10/${share}` }
    expect(normaliseSmbTarget(generated).name).toBe(formatSmbPath({
      host: '192.168.1.10',
      share: 'shared',
      folder: 'torrents/downloads'
    }))
  })

  it('relabels even when the generated name and the share drifted apart', () => {
    // What the bug report actually held: a label generated before a stray
    // separator was added to the share, so the two no longer match exactly.
    const drifted = {
      ...base,
      share: '\\shared\\torrents\\downloads\\',
      name: '192.168.1.10/shared\\torrents\\downloads'
    }
    expect(normaliseSmbTarget(drifted).name).toBe(formatSmbPath({
      host: '192.168.1.10',
      share: 'shared',
      folder: 'torrents/downloads'
    }))
  })

  it('never rewrites a name somebody chose', () => {
    const chosen = { ...base, share: 'shared', name: 'the NAS in the cupboard' }
    expect(normaliseSmbTarget(chosen).name).toBe('the NAS in the cupboard')
  })

  it('keeps the name and credentials it was given', () => {
    const fixed = normaliseSmbTarget({ ...base, share: '\\shared\\torrents\\downloads\\' })
    expect(fixed.name).toBe('the one from the bug report')
    expect(fixed.username).toBe('someone')
    expect(fixed.id).toBe('x')
  })
})
