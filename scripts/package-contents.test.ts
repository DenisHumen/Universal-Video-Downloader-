import { describe, expect, it } from 'vitest'
import { ASAR_BUDGET, REQUIRED, packageProblems } from './package-contents.mjs'

const MAIN = 'x = "Показать в папке"; y = "Не удалось использовать этот файл";'
const check = (extra: string[] = [], main = MAIN, size = 1000): string[] =>
  packageProblems([...REQUIRED, ...extra], main, size)

describe('packageProblems', () => {
  it('passes a package holding what it should', () => {
    expect(check(['out/renderer/assets/index.js', 'node_modules/moment/LICENSE'])).toEqual([])
  })

  it('names a file the app opens at run time when it is gone', () => {
    const entries = REQUIRED.filter((path) => path !== 'out/preload/site.js')
    expect(packageProblems(entries, MAIN, 1000)).toEqual(['out/preload/site.js is missing'])
  })

  it.each([
    ['tests/visual/baseline/home.png', 'a repository folder'],
    ['test/setup-dom.ts', 'a repository folder'],
    ['eslint.config.mjs', 'a repository file'],
    ['.nvmrc', 'a repository dotfile'],
    ['out/main/index.js.map', 'a source map'],
    ['node_modules/react/index.js', 'a development dependency'],
    ['node_modules/@testing-library/react/index.js', 'a development dependency'],
    ['node_modules/foo/node_modules/vite/index.js', 'a development dependency']
  ])('refuses %s', (path, what) => {
    expect(check([path]).join()).toContain(what)
  })

  it('is not fooled by a dependency that only sounds like one it refuses', () => {
    expect(check(['node_modules/react-foo/index.js', 'node_modules/electron-updater/index.js'])).toEqual([])
  })

  it('wants both dictionaries in the main bundle', () => {
    expect(check([], 'x = "Показать в папке"').join()).toContain("the interface's dictionary")
    expect(check([], 'x = "Не удалось использовать этот файл"').join()).toContain("main's own dictionary")
  })

  it('refuses React in the main bundle', () => {
    expect(check([], `${MAIN} Symbol.for("react.transitional.element")`)).toEqual(['the main bundle has React in it'])
  })

  it('holds the archive to its budget', () => {
    expect(check([], MAIN, ASAR_BUDGET)).toEqual([])
    expect(check([], MAIN, ASAR_BUDGET + 1).join()).toContain('over the budget')
  })
})
