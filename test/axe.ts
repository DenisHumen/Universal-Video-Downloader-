import axe from 'axe-core'

/**
 * Run axe over `root` and return its violations as readable lines.
 *
 * Colour contrast is off: jsdom computes no styles, and contrast has its own
 * gate (scripts/check-contrast.mjs) that checks every token pairing.
 */
export async function axeViolations(root: Element): Promise<string[]> {
  const result = await axe.run(root, {
    rules: {
      'color-contrast': { enabled: false },
      // A component rendered on its own has no page landmarks or <h1>.
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
      'landmark-one-main': { enabled: false }
    }
  })
  return result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
  )
}
