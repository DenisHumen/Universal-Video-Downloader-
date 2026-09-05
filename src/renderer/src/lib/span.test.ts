import { describe, expect, it } from 'vitest'
import { span } from './span'

/*
  The interval picker said "every 1440 min" and the next-check line said
  "in 2 h" in a Russian interface. Both are the same mistake: numbers spoken in
  the wrong unit, or the right unit in the wrong language.
*/
describe('span', () => {
  it('keeps minutes under an hour as minutes', () => {
    expect(span(15)).toEqual({ n: 15, unit: 'min' })
    expect(span(59)).toEqual({ n: 59, unit: 'min' })
  })

  it('turns whole hours into hours', () => {
    expect(span(60)).toEqual({ n: 1, unit: 'h' })
    expect(span(360)).toEqual({ n: 6, unit: 'h' })
    expect(span(720)).toEqual({ n: 12, unit: 'h' })
  })

  it('turns a day or more into days', () => {
    expect(span(1440)).toEqual({ n: 1, unit: 'd' })
    expect(span(2880)).toEqual({ n: 2, unit: 'd' })
  })

  it('shows one decimal rather than lying about a round number', () => {
    expect(span(90)).toEqual({ n: 1.5, unit: 'h' })
    expect(span(2160)).toEqual({ n: 1.5, unit: 'd' })
  })

  it('never goes negative', () => {
    expect(span(-5)).toEqual({ n: 0, unit: 'min' })
  })
})
