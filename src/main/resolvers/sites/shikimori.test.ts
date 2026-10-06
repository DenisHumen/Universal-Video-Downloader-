import { describe, expect, it } from 'vitest'
import { classifyYtdlpError } from '../../services/options'
import { hasResolver } from '../index'
import {
  NOT_ON_YUMMY,
  pickByShikimoriId,
  SHIKIMORI_ANIME,
  searchNames,
  shikimoriId
} from './shikimori'
import type { YaniSearchItem } from './yummyani'

/*
  A Shikimori link got nothing: the engine calls it "Unsupported URL", and the
  page has no player in it. The same title is usually on YummyAnime, so the
  link is matched to it by the Shikimori id yani.tv files against each title.
*/
describe('SHIKIMORI_ANIME', () => {
  it('reads the id on every Shikimori host, with or without the slug', () => {
    for (const url of [
      'https://shikimori.io/animes/52991-sousou-no-frieren',
      'https://shikimori.one/animes/52991-sousou-no-frieren',
      'https://shikimori.me/animes/52991',
      'https://www.shikimori.io/animes/52991-sousou-no-frieren/'
    ]) {
      expect(shikimoriId(url), url).toBe(52991)
    }
  })

  it('reads an id with a letter in front of it', () => {
    expect(shikimoriId('https://shikimori.one/animes/z52991-sousou-no-frieren')).toBe(52991)
  })

  it('leaves manga, ranobe and everything else alone', () => {
    for (const url of [
      'https://shikimori.io/mangas/118586-sousou-no-frieren',
      'https://shikimori.io/ranobe/12345-something',
      'https://shikimori.io/animes',
      'https://shikimori.io/users/someone',
      'https://notshikimori.io/animes/52991'
    ]) {
      expect(SHIKIMORI_ANIME.test(url), url).toBe(false)
    }
  })

  it('is a link the app now has a resolver for', () => {
    expect(hasResolver('https://shikimori.one/animes/52991-sousou-no-frieren')).toBe(true)
  })
})

describe('searchNames', () => {
  it('searches by the romanised name first, then English, then Russian', () => {
    // By the Russian title, the yani.tv search found nothing for Frieren.
    const names = searchNames({
      id: 52991,
      name: 'Sousou no Frieren',
      english: ["Frieren: Beyond Journey's End"],
      russian: 'Провожающая в последний путь Фрирен'
    })
    expect(names).toEqual([
      'Sousou no Frieren',
      "Frieren: Beyond Journey's End",
      'Провожающая в последний путь Фрирен'
    ])
  })

  it('asks once per name, and skips the ones a title does not have', () => {
    expect(searchNames({ id: 1, name: 'Naruto', english: ['Naruto'], russian: 'Наруто' })).toEqual([
      'Naruto',
      'Наруто'
    ])
    expect(searchNames({ id: 1, name: 'Naruto', english: [null], russian: null })).toEqual(['Naruto'])
    expect(searchNames({ id: 1, name: 'Naruto', english: [] })).toEqual(['Naruto'])
  })
})

/*
  The yani.tv search for Frieren, trimmed to what the code reads: the series,
  a set of chibi specials, the second season and a later arc, all under nearly
  the same title. Only the id tells them apart.
*/
const item = (anime_id: number, shikimori_id: number | string, title: string): YaniSearchItem => ({
  anime_id,
  anime_url: `title-${anime_id}`,
  title,
  remote_ids: { shikimori_id }
})
const frierenSearch: YaniSearchItem[] = [
  item(11312, 56885, 'Провожающая в последний путь Фрирен: Магия'),
  item(10661, 52991, 'Провожающая в последний путь Фрирен'),
  item(15084, 59978, 'Провожающая в последний путь Фрирен 2'),
  item(27416, 63816, 'Провожающая в последний путь Фрирен: Золотая земля')
]

describe('pickByShikimoriId', () => {
  it('picks the title with the same Shikimori id, wherever the search put it', () => {
    expect(pickByShikimoriId(frierenSearch, 52991)?.anime_id).toBe(10661)
    expect(pickByShikimoriId([...frierenSearch].reverse(), 59978)?.anime_id).toBe(15084)
  })

  it('never settles for a sibling season when the title itself is missing', () => {
    // A near match would quietly open a different season under the same name.
    const without = frierenSearch.filter((it) => it.anime_id !== 10661)
    expect(pickByShikimoriId(without, 52991)).toBeUndefined()
  })

  it('reads an id that came as a string, and skips hits with no ids at all', () => {
    expect(pickByShikimoriId([item(10661, '52991', 'Фрирен')], 52991)?.anime_id).toBe(10661)
    const bare: YaniSearchItem = { anime_id: 1, anime_url: 'x', title: 'Фрирен' }
    expect(pickByShikimoriId([bare], 52991)).toBeUndefined()
  })
})

describe('a Shikimori title YummyAnime does not have', () => {
  it('is said in words, not passed over as a network failure', () => {
    // resolveUrl falls back in silence on anything shaped like an HTTP status.
    expect(NOT_ON_YUMMY).not.toMatch(/HTTP \d{3}|timed out/i)
    expect(classifyYtdlpError(NOT_ON_YUMMY, false)).toMatchObject({
      code: 'notOnYummyAnime',
      cookieHint: false
    })
  })
})
