import { describe, expect, it } from 'vitest'
import { aksorHash, aksorTiers, pickAksorTier } from './aksor'

/*
  The player's answer for one episode, as /api/video/<hash> gives it: every
  height it knows of, the ones the episode does not come in set to null.
*/
const answer = (over: Record<string, string | null> = {}): Record<string, string | null> => ({
  q1080: 'https://cdn10.takehost-cdn.aksor.tv/static13/video/a10661/AniLibria/01/1080.mpd',
  q360: null,
  q480: null,
  q720: null,
  q2k: null,
  q4k: null,
  ...over
})
const mpd = (name: string): string => `https://cdn.aksor.tv/a/${name}.mpd`

describe('aksorTiers', () => {
  it('offers only the heights that have a manifest, not every key in the answer', () => {
    // Read as offers, the nulls would have put five heights in the picker that
    // fail the moment one is chosen.
    expect(aksorTiers(answer()).map((t) => t.height)).toEqual([1080])
  })

  it('reads q2k and q4k as 1440 and 2160, not 2 and 4', () => {
    // parseInt on the key would have ranked the 4K manifest lowest of all.
    const tiers = aksorTiers(answer({ q4k: mpd('4k'), q2k: mpd('2k'), q720: mpd('720') }))
    expect(tiers.map((t) => t.height)).toEqual([720, 1080, 1440, 2160])
    expect(tiers[3].url).toBe(mpd('4k'))
  })

  it('reads a key that is a plain height, and skips one it cannot place', () => {
    const tiers = aksorTiers({ q1440: mpd('1440'), qhd: mpd('hd') })
    expect(tiers.map((t) => t.height)).toEqual([1440])
  })

  it('writes a studio name with a space in it out as a proper address', () => {
    // "JAM CLUB" is a real folder on the CDN.
    const cdn = 'https://cdn13.takehost-cdn.aksor.tv/static13/video/a4981'
    const [tier] = aksorTiers(answer({ q1080: `${cdn}/JAM CLUB/01/1080.mpd` }))
    expect(tier.url).toBe(`${cdn}/JAM%20CLUB/01/1080.mpd`)
  })

  it('takes nothing from an empty value, a non-address or a missing answer', () => {
    expect(aksorTiers(answer({ q1080: '  ', q720: 'not a url' }))).toEqual([])
    expect(aksorTiers(undefined)).toEqual([])
    expect(aksorTiers(null)).toEqual([])
  })
})

describe('pickAksorTier', () => {
  const tiers = aksorTiers(answer({ q480: mpd('480'), q720: mpd('720') }))

  it('takes the height asked for, or the nearest below it', () => {
    expect(pickAksorTier(tiers, '720p')?.height).toBe(720)
    expect(pickAksorTier(tiers, '1000')?.height).toBe(720)
    expect(pickAksorTier(tiers, '1080')?.height).toBe(1080)
  })

  it('takes the lowest when everything is above the request, not the highest', () => {
    // The same rule as Kodik: 360p asked of a title in 480p and up is closest at 480p.
    expect(pickAksorTier(tiers, '360p')?.height).toBe(480)
  })

  it('takes the highest for "best", and for an audio download', () => {
    expect(pickAksorTier(tiers, 'best')?.height).toBe(1080)
    expect(pickAksorTier(tiers, 'audio')?.height).toBe(1080)
  })

  it('has nothing to give when the episode has no manifest at all', () => {
    expect(pickAksorTier([], 'best')).toBeUndefined()
  })
})

describe('aksorHash', () => {
  it('reads the episode out of a player address', () => {
    expect(aksorHash('https://player.aksor.tv/video/36c45284528fe5b4f30a39d9f008d1b8')).toBe(
      '36c45284528fe5b4f30a39d9f008d1b8'
    )
    expect(aksorHash('//player.aksor.tv/video/0ca94c89d7abb7dc4eb8734718674cc7?autoplay=1')).toBe(
      '0ca94c89d7abb7dc4eb8734718674cc7'
    )
  })

  it('does not read one out of another player, or a host that only starts like Aksor', () => {
    expect(aksorHash('https://alloha.yani.tv/video/36c45284')).toBeUndefined()
    expect(aksorHash('https://player.aksor.tv.example.com/video/36c45284')).toBeUndefined()
    expect(aksorHash('https://player.aksor.tv/')).toBeUndefined()
  })
})
