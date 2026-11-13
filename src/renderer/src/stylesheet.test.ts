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

describe('type sizes in the source', () => {
  /*
    4.0 type scale (plan 2.5): hero, title, section, body, control, meta,
    caption. An arbitrary size is how the 3.x interface drifted to seven
    near-identical ones; a new size goes into tailwind.config.js or nowhere.
  */
  it('uses the type scale, never text-[Npx]', () => {
    const arbitrary = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/\btext-\[\d+(?:\.\d+)?px\]/g)].map((m) => `${file}: ${m[0]}`)
    )
    expect(arbitrary).toEqual([])
  })
})

describe('motion tokens', () => {
  const css = readFileSync(join(ROOT, 'index.css'), 'utf-8')

  // Plan 2.6: press 90, fast 140, base 200, slow 260, plus the spring curve.
  it('defines the 4.0 durations and curves', () => {
    for (const [name, value] of [
      ['--t-press', '90ms'],
      ['--t-fast', '140ms'],
      ['--t-base', '200ms'],
      ['--t-slow', '260ms']
    ]) {
      expect(css).toMatch(new RegExp(`${name}:\\s*${value};`))
    }
    // libadwaita's critically damped spring as CSS linear(): no overshoot (A1).
    expect(css).toMatch(/--ease-spring:\s*linear\(0,[^)]*, 1\);/)
  })

  it('writes no millisecond literal outside the tokens and the reduced-motion override', () => {
    const literals = css
      .split('\n')
      .filter((line) => /\d+ms/.test(line) && !/^\s*--t-/.test(line) && !/0\.01ms !important/.test(line))
    expect(literals).toEqual([])
  })

  it('collapses every animation and transition under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/)
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/)
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

  /*
    Two rings once: `accent/.5` at 1.45-2.14:1, outside on .btn-* and inside on
    .ui-*. Controls ring outside, on the plane; what fills its container, inside.
  */
  it('rings every control the same way, in the focus token', async () => {
    for (const control of ['btn-solid', 'btn-quiet', 'ui-btn', 'ui-icon-btn', 'ui-switch', 'ui-check', 'ui-segment', 'ui-dropdown']) {
      const decls = await declsFor(`.${control}:focus-visible`)
      expect(decls, control).toContainEqual({ outline: '2px solid rgb(var(--focus))' })
      expect(decls, control).toContainEqual({ 'outline-offset': '2px' })
    }
    for (const filling of ['ui-row-activatable', 'ui-menu-item', 'ui-nav-item']) {
      const decls = await declsFor(`.${filling}:focus-visible`)
      expect(decls, filling).toContainEqual({ outline: '2px solid rgb(var(--focus))' })
      expect(decls, filling).toContainEqual({ 'outline-offset': '-2px' })
    }
  })

  it('gives whatever has no ring of its own the same one, below every class', async () => {
    const decls = await declsFor(':focus-visible')
    expect(decls).toContainEqual({ outline: '2px solid rgb(var(--focus))' })
    const all = await rules()
    expect(all.findIndex((r) => r.selectors.includes(':focus-visible'))).toBeLessThan(
      all.findIndex((r) => r.selectors.includes('.btn-quiet:focus-visible'))
    )
  })

  // bg-accent/90 let the page through, and the white label fell to 4.03:1 on a light one.
  it('darkens solid buttons under the pointer instead of thinning them', async () => {
    for (const variant of ['btn-solid', 'ui-btn-primary']) {
      const props = (await declsFor(`.${variant}:hover`)).flatMap(Object.keys)
      expect(props, variant).toContain('filter')
      expect(props, variant).not.toContain('background-color')
    }
  })

  // GNOME 50's destructive button is a tint with the red as its label; the pointer deepens the tint.
  it('draws destructive buttons as a red label on a tint that deepens under the pointer', async () => {
    for (const variant of ['btn-danger', 'ui-btn-danger']) {
      expect((await declsFor(`.${variant}:hover`)).flatMap(Object.keys), variant).toContain('background-color')
      const base = (await declsFor(`.${variant}`)).reduce((all, d) => ({ ...all, ...d }), {} as Record<string, string>)
      expect(base.color, variant).toContain('--destructive-ink')
    }
  })

  // Day's quiet buttons were a 1.06:1 fill on a white panel: there, but unseen.
  /*
    A1 retired the hairline (--control-edge): GNOME's controls are the text
    colour at .10, which reads on every plane in both themes (D0, and the
    contrast gate's control-fill checks).
  */
  it('fills the neutral controls with the text colour at .10, edge-free', async () => {
    expect(await winning('.btn-quiet', 'background-color')).toContain('var(--fill)')
    expect(await winning('.btn-icon', 'background-color')).toContain('var(--fill)')
    expect(await winning('.btn-quiet', 'box-shadow')).toBeUndefined()
  })

  /*
    A `[data-theme='day'] .btn-icon` rule was the first try, and `@apply
    btn-icon` copied it straight into the bare toolbar buttons — giving them the
    very edge they exist to go without.
  */
  it('keeps the bare icon buttons bare', async () => {
    expect(await winning('.btn-icon-bare', 'background-color')).toBe('transparent')
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
