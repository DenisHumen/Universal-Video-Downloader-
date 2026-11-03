import { describe, expect, it } from 'vitest'
import { isMultiLink, parseBatch } from './batch'

describe('parseBatch (5.4 inline batch)', () => {
  it('keeps links in order, drops repeats and lists what is not a link', () => {
    const r = parseBatch('https://a.example/1\nnot a link\nhttps://b.example/2\n\nhttps://a.example/1')
    expect(r.links).toEqual(['https://a.example/1', 'https://b.example/2'])
    expect(r.duplicates).toBe(1)
    expect(r.invalid).toEqual(['not', 'a', 'link'])
  })

  it('treats several links as a batch, one link or a title as not', () => {
    expect(isMultiLink('https://a.example/1\nhttps://b.example/2')).toBe(true)
    expect(isMultiLink('https://a.example/1')).toBe(false)
    expect(isMultiLink('big buck bunny')).toBe(false)
    expect(isMultiLink('https://a.example/1\nhttps://a.example/1')).toBe(false)
  })
})
