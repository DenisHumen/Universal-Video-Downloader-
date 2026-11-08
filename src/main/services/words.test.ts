import { describe, expect, it } from 'vitest'
import type { AppErrorCode } from '@shared/types'
import { errorText } from '../../renderer/src/lib/errors'
import { translate, type TranslateFn } from '../../renderer/src/i18n/translate'
import { REPORTABLE } from '@shared/report'
import { decimalIn, reasonIn } from './words'

const ru: TranslateFn = (key, params) => translate('ru', key, params)

describe('reasonIn', () => {
  // A phone and the screen have to say the same thing, for every code there is.
  it('says for each code what the window says', () => {
    const codes = Object.keys(REPORTABLE) as AppErrorCode[]
    expect(codes.length).toBeGreaterThan(30)
    for (const errorCode of codes) {
      expect(reasonIn('ru', 'raw engine words', errorCode), errorCode).toBe(errorText(ru, { error: 'raw engine words', errorCode }))
    }
  })

  it('translates one of main’s fixed sentences, which has no code', () => {
    expect(reasonIn('ru', 'The share is full.')).toMatch(/закончилось место/)
    expect(reasonIn('ru', 'HTTP 503')).toMatch(/сервер/i)
  })

  it('leaves what it does not know as written', () => {
    expect(reasonIn('ru', 'Series/S01E01.mp4')).toBe('Series/S01E01.mp4')
    expect(reasonIn('en', 'The share is full.')).toBe('The share is full.')
  })

  it('does not blame the connection for an engine that will not start', () => {
    expect(reasonIn('ru', 'The download engine was installed but failed to start on this system.', 'engineMissing')).toMatch(
      /антивирус/
    )
  })
})

describe('decimalIn', () => {
  it('writes the separator the way the language does', () => {
    expect(decimalIn('en', 1.5, 2)).toBe('1.50')
    expect(decimalIn('ru', 1.5, 2)).toBe('1,50')
  })
})
