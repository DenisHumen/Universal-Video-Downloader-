import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { TELEGRAM_NO_TOKEN } from '@shared/automation'
import { translate, useI18n, type TranslateFn } from '../i18n'
import { describeError, errorText } from './errors'
import { localizeMainText } from './mainText'

afterEach(() => useI18n.setState({ language: 'en' }))

const ru: TranslateFn = ((key: never, params?: never) => translate('ru', key, params)) as TranslateFn
const en: TranslateFn = ((key: never, params?: never) => translate('en', key, params)) as TranslateFn

const MAIN = join(__dirname, '../../../main')

/** Everything main can put on a watch, a run or a toast. */
const SOURCES = [
  'services/automation/smb.ts',
  'services/automation/telegram.ts',
  'services/automation/detect.ts',
  'services/automation/pipeline.ts',
  'services/automation/watcher.ts',
  'services/automation/await-download.ts',
  'resolvers/http.ts',
  'resolvers/sites/rezka.ts',
  'resolvers/sites/kodik.ts',
  'resolvers/sites/aniliberty.ts',
  'resolvers/sites/yummyani.ts',
  'resolvers/sites/shikimori.ts'
]

/** Comments, log lines and what only ever goes to Telegram are not on any screen. */
function shown(source: string): string {
  let text = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '')
    .split('export interface EpisodeNews')[0]
  for (;;) {
    const at = text.search(/\blog\.(?:debug|info|warn|error)\(/)
    if (at < 0) return text
    let depth = 0
    let end = text.indexOf('(', at)
    do {
      if (text[end] === '(') depth++
      else if (text[end] === ')') depth--
      end++
    } while (depth > 0 && end < text.length)
    text = text.slice(0, at) + text.slice(end)
  }
}

/** A `${...}` in a template, as a value of the kind it would hold. */
function sample(template: string): string {
  return template.replace(/\$\{([^}]*)\}/g, (_all, expression: string) => {
    if (/toString\(16\)/.test(expression)) return 'c0000001'
    if (/length|status/.test(expression)) return '503'
    return 'example'
  })
}

const LITERAL = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g

function sentences(source: string): string[] {
  const code = shown(source)
  const found = new Set<string>()
  for (const m of code.matchAll(LITERAL)) {
    const text = m[1] ?? m[2] ?? m[3] ?? ''
    // Reads as a sentence: a capital or a quoted host first, a space inside, a stop at the end.
    if (/^(?:[A-Z]|\$\{)/.test(text) && text.includes(' ') && /[.?]$/.test(text)) found.add(text)
  }
  // Whatever a thrown error says is shown too, stop or no stop.
  for (const m of code.matchAll(/new \w*Error\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`)/g)) {
    found.add(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return [...found].map((text) => sample(text.replace(/\\(['"`])/g, '$1')))
}

describe('every sentence main can show', () => {
  const all = SOURCES.flatMap((file) =>
    sentences(readFileSync(join(MAIN, file), 'utf-8')).map((sentence) => [file, sentence] as const)
  )

  it('is found, so this suite tests something', () => {
    expect(all.length).toBeGreaterThan(50)
    expect(all.map(([, s]) => s)).toContain('The share is full.')
    expect(all.map(([, s]) => s)).toContain('HTTP 503')
    expect(all.map(([, s]) => s)).toContain('Connected. 503 item(s) in example.')
  })

  it.each(all)('%s: "%s" has a Russian entry', (_file, sentence) => {
    const out = localizeMainText(ru, sentence)
    expect(out, 'add it to the table in lib/mainText.ts').not.toBe(sentence)
    expect(out).toMatch(/[а-яё]/i)
    expect(out).not.toMatch(/\{\w+\}/)
  })

  // The network sentences are put together from parts, so the parts are what is checked.
  it('covers each reason and piece of advice in neterror.ts', () => {
    const source = shown(readFileSync(join(MAIN, 'resolvers/neterror.ts'), 'utf-8'))
    const literals = [...source.matchAll(/'((?:[^'\\\n])*)'/g)].map((m) => m[1])
    const reasons = literals.filter((s) => /^(?:the |a network|could not)/.test(s))
    const advice = literals.filter((s) => /^Check /.test(s))
    expect(reasons.length).toBeGreaterThanOrEqual(12)
    expect(advice).toHaveLength(2)
    for (const reason of reasons) {
      for (const tip of advice) {
        const said = `Could not reach example.com: ${reason}. ${tip} (ERR_CONNECTION_REFUSED)`
        const out = localizeMainText(ru, said)
        expect(out, said).toMatch(/^Не удалось подключиться к example\.com: /)
        expect(out).not.toContain('ERR_')
      }
    }
  })

  it('includes the Telegram token that is missing', () => {
    expect(localizeMainText(ru, TELEGRAM_NO_TOKEN)).toMatch(/токен/i)
  })
})

describe('localizeMainText', () => {
  it('fills in what a sentence quotes', () => {
    expect(localizeMainText(ru, 'Could not reach 192.168.1.10. Is it on, and on this network?')).toContain(
      '192.168.1.10'
    )
    expect(localizeMainText(ru, 'Connected. 7 item(s) in video/series.')).toBe(
      'Подключено. Объектов в папке video/series: 7.'
    )
    expect(localizeMainText(ru, 'Connected as @example_bot.')).toContain('@example_bot')
    expect(localizeMainText(ru, 'No password is stored for "NAS". Enter it again in Settings.')).toContain('«NAS»')
  })

  it('says the status of a bare HTTP answer as what it means', () => {
    expect(localizeMainText(ru, 'HTTP 503')).toMatch(/сервер/i)
    expect(localizeMainText(ru, 'HTTP 404')).toMatch(/страниц/i)
    expect(localizeMainText(ru, 'HTTP 403')).toMatch(/встроенном браузере/)
    expect(localizeMainText(ru, 'HTTP 429')).toMatch(/подождите/i)
    expect(localizeMainText(ru, 'HTTP 418')).toContain('418')
  })

  it('passes through what it does not know: a path, a file name, the engine', () => {
    for (const text of ['Series/S01E01.mp4', 'ERROR: something new', 'Connected to nothing', 'constructor']) {
      expect(localizeMainText(ru, text)).toBe(text)
    }
  })

  it('reads the same in English as main wrote it', () => {
    for (const text of ['The share is full.', 'Done by the earlier attempt.', 'Telegram is not set up.']) {
      expect(localizeMainText(en, text)).toBe(text)
    }
  })

  it('leaves an unknown network reason whole rather than half translated', () => {
    const said = 'Could not reach a.example: something new. Check your connection or proxy. (ERR_FAILED)'
    expect(localizeMainText(ru, said)).toBe(said)
  })
})

describe('where the table is used', () => {
  it('reaches an error that crossed the bridge', () => {
    const err = new Error("Error invoking remote method 'auto:test-smb': SmbError: The share is full.")
    useI18n.setState({ language: 'ru' })
    expect(describeError(err)).toMatch(/закончилось место/)
    expect(describeError(new Error('Some new sentence.'))).toBe('Some new sentence.')
  })

  it('reaches a failure with no code, and yields to one that has it', () => {
    expect(errorText(ru, { error: 'The share is full.' })).toMatch(/закончилось место/)
    expect(errorText(ru, { error: 'The share is full.', errorCode: 'diskFull' })).toMatch(/На диске нет места/)
  })
})
