import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import postcss, { type Rule } from 'postcss'
import tailwindcss from 'tailwindcss'
import { describe, expect, it } from 'vitest'

const ROOT = join('src', 'renderer', 'src')

const tsxFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path))
    else if (entry.endsWith('.tsx')) out.push(path)
  }
  return out
}

/** Every quoted string in a file that names a button class, split into classes. */
const buttonClassLists = (source: string): string[][] =>
  [...source.matchAll(/(['"`])([^'"`\n]*\bbtn\b[^'"`\n]*)\1/g)].map((m) => m[2].split(/\s+/))

const sources = tsxFiles(ROOT).map((file) => ({ file, text: readFileSync(file, 'utf-8') }))

describe('button classes in the source', () => {
  /*
    The base class was `.btn`: shape and behaviour, no fill. Fourteen buttons
    across Automation, the dialogs and the update strip used it on its own and
    rendered as bare words — "look" and "cancel" beside filled fields, a
    disabled "send a test message" indistinguishable from body text.
  */
  it('never uses the old bare base class', () => {
    const bare = sources.flatMap(({ file, text }) =>
      buttonClassLists(text)
        .filter((classes) => classes.includes('btn'))
        .map((classes) => `${file}: ${classes.join(' ')}`)
    )
    expect(bare).toEqual([])
  })

  // The renamed base is still only shape: on its own it is the same bug again.
  it('only uses the base class with a fill of its own', () => {
    const unfilled = sources.flatMap(({ file, text }) =>
      buttonClassLists(text)
        .filter((classes) => classes.includes('btn-base'))
        .filter((classes) => !classes.some((c) => c.startsWith('bg-')))
        .map((classes) => `${file}: ${classes.join(' ')}`)
    )
    expect(unfilled).toEqual([])
  })
})

/*
  The stylesheet as Tailwind actually builds it: what @apply copies and what
  order the layers land in decide how things look, and neither shows up in the
  source.
*/
describe('the built stylesheet', () => {
  const build = async (): Promise<Rule[]> => {
    const from = join(ROOT, 'index.css')
    const built = await postcss([tailwindcss('tailwind.config.js')]).process(
      readFileSync(from, 'utf-8'),
      { from }
    )
    const rules: Rule[] = []
    built.root.walkRules((rule) => {
      rules.push(rule)
    })
    return rules
  }
  let cached: Promise<Rule[]> | undefined
  const rules = (): Promise<Rule[]> => (cached ??= build())

  /** Every declaration that applies to exactly this selector, in source order. */
  const declsFor = async (selector: string): Promise<Record<string, string>[]> =>
    (await rules())
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) =>
        rule.nodes.flatMap((n) => (n.type === 'decl' ? [{ [n.prop]: n.value }] : []))
      )
  /** What a property resolves to on a plain (unhovered, unfocused) element. */
  const winning = async (selector: string, prop: string): Promise<string | undefined> =>
    (await declsFor(selector)).flatMap((d) => (prop in d ? [d[prop]] : [])).pop()

  /*
    The variants get their outline only through `@apply btn-base` copying
    `.btn-base:focus-visible`: a rename or a broken chain drops it from every
    text button with no error anywhere.
  */
  it('keeps a focus outline on every text button', async () => {
    for (const variant of ['btn-solid', 'btn-quiet', 'btn-danger']) {
      const props = (await declsFor(`.${variant}:focus-visible`)).flatMap(Object.keys)
      expect(props, variant).toContain('outline')
    }
  })

  // Day's quiet buttons were a 1.06:1 fill on a white panel: there, but unseen.
  it('edges the neutral buttons with the theme hairline', async () => {
    expect(await winning('.btn-quiet', 'box-shadow')).toContain('var(--control-edge)')
    expect(await winning('.btn-icon', 'border-color')).toBe('var(--control-edge)')
  })

  /*
    A `[data-theme='day'] .btn-icon` rule was the first try, and `@apply
    btn-icon` copied it straight into the bare toolbar buttons — giving them the
    very edge they exist to go without.
  */
  it('keeps the bare icon buttons bare', async () => {
    expect(await winning('.btn-icon-bare', 'border-color')).toBe('transparent')
    const themed = (await rules()).filter((rule) =>
      rule.selectors.some((s) => s.includes('[data-theme') && s.includes('.btn'))
    )
    expect(themed.map((rule) => rule.selector)).toEqual([])
  })

  /*
    The type roles used to come after the utilities, so `label text-accent-ink`
    and `hint text-bad` rendered in the role's own grey: equal specificity, and
    the later rule wins.
  */
  it('lets a colour utility recolour a type role', async () => {
    const all = await rules()
    const at = (selector: string): number => all.findIndex((r) => r.selectors.includes(selector))
    for (const role of ['.h1', '.h2', '.lead', '.hint', '.label']) {
      expect(at(role), role).toBeGreaterThanOrEqual(0)
      expect(at(role), role).toBeLessThan(at('.text-bad'))
    }
  })
})
