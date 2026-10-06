import { describe, expect, it } from 'vitest'
import {
  createProxyApplier,
  PROBE_URL,
  proxyConfig,
  type ProxyConfig,
  type ProxyTarget
} from './proxy-queue'
import type { ChromiumProxy } from './proxy-rules'

/*
  The proxy reached only the default session, so the built-in browser and the
  hidden detection windows went out directly whatever was set. And because the
  guard was written only after `setProxy` resolved, the two calls a launch makes
  in the same tick both went through, and every prefix of a proxy being typed
  was applied in turn.
*/

interface Fake extends ProxyTarget {
  calls: ProxyConfig[]
  probes: string[]
}

/** Resolves like Chromium does for rules it took: `PROXY host:port`. */
function took(config: ProxyConfig): string {
  if (!('proxyRules' in config)) return 'DIRECT'
  return `PROXY ${config.proxyRules.replace(/^[a-z0-9]+:\/\//, '')}`
}

function target(
  name: string,
  fail?: (config: ProxyConfig) => boolean,
  resolve: (config: ProxyConfig) => string = took
): Fake {
  const calls: ProxyConfig[] = []
  const probes: string[] = []
  let current: ProxyConfig = { mode: 'system' }
  return {
    name,
    calls,
    probes,
    setProxy: async (config) => {
      calls.push(config)
      if (fail?.(config)) throw new Error(`${name} refused`)
      current = config
    },
    resolveProxy: async (url) => {
      probes.push(url)
      return resolve(current)
    }
  }
}

function setup(targets: Fake[]): {
  apply: (proxy: string | undefined) => Promise<void>
  applied: string[]
  plans: { plan: ChromiumProxy; resolved: string }[]
  failed: string[]
  refused: string[]
} {
  const applied: string[] = []
  const plans: { plan: ChromiumProxy; resolved: string }[] = []
  const failed: string[] = []
  const refused: string[] = []
  const apply = createProxyApplier(() => targets, {
    applied: (plan, resolved) => {
      applied.push(plan.rules)
      plans.push({ plan, resolved })
    },
    failed: (name, why) => failed.push(`${name}: ${why}`),
    refused: (name, resolved) => refused.push(`${name}: ${resolved}`)
  })
  return { apply, applied, plans, failed, refused }
}

describe('proxyConfig', () => {
  it('hands Chromium the rules, or the system network when there are none', () => {
    expect(proxyConfig('http://192.168.1.10:8080')).toEqual({ proxyRules: 'http://192.168.1.10:8080' })
    expect(proxyConfig('')).toEqual({ mode: 'system' })
  })
})

describe('createProxyApplier', () => {
  it('sets every session, not only the default one', async () => {
    const def = target('default')
    const browsing = target('browsing')
    const { apply, applied } = setup([def, browsing])
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toEqual([{ proxyRules: 'http://192.168.1.10:8080' }])
    expect(browsing.calls).toEqual([{ proxyRules: 'http://192.168.1.10:8080' }])
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })

  it('applies the two same-tick calls of a launch once per session, with one log line', async () => {
    const def = target('default')
    const browsing = target('browsing')
    const { apply, applied } = setup([def, browsing])
    const first = apply('')
    const second = apply('')
    await Promise.all([first, second])
    expect(def.calls).toHaveLength(1)
    expect(browsing.calls).toHaveLength(1)
    expect(applied).toEqual([''])
  })

  it('never sends Chromium a value the user has already moved past', async () => {
    const def = target('default')
    const { apply, applied } = setup([def])
    void apply('h')
    void apply('ht')
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toEqual([{ proxyRules: 'http://192.168.1.10:8080' }])
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })

  it('trims, so a stray space is not a different proxy', async () => {
    const def = target('default')
    const { apply } = setup([def])
    await apply('http://192.168.1.10:8080')
    await apply('  http://192.168.1.10:8080 ')
    expect(def.calls).toHaveLength(1)
  })

  it('retries a value that failed when it is saved again', async () => {
    let refuse = true
    const def = target('default', () => refuse)
    const browsing = target('browsing')
    const { apply, applied, failed } = setup([def, browsing])
    await apply('http://192.168.1.10:8080')
    expect(failed).toEqual(['default: default refused'])
    expect(applied).toEqual([])

    refuse = false
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toHaveLength(2)
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })

  it('does not let a failure cancel a newer value waiting behind it', async () => {
    const def = target('default', (config) => 'proxyRules' in config && config.proxyRules === 'bad')
    const { apply, applied } = setup([def])
    const first = apply('bad')
    // Queued while the first is still in Chromium's hands.
    await Promise.resolve()
    const second = apply('http://192.168.1.10:8080')
    await Promise.all([first, second])
    expect(def.calls).toEqual([{ proxyRules: 'bad' }, { proxyRules: 'http://192.168.1.10:8080' }])
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })

  it('keeps working after the sessions could not even be listed', async () => {
    let ready = false
    const def = target('default')
    const applied: string[] = []
    const failed: string[] = []
    const apply = createProxyApplier(
      () => {
        if (!ready) throw new Error('not ready')
        return [def]
      },
      {
        applied: (plan) => applied.push(plan.rules),
        failed: (name, why) => failed.push(`${name}: ${why}`),
        refused: () => undefined
      }
    )
    await apply('http://192.168.1.10:8080')
    expect(failed).toEqual(['all: not ready'])

    ready = true
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toHaveLength(1)
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })
})

/*
  `http://user:pass@host` and `socks5h://host` went to Chromium as typed.
  `setProxy` resolved, the log said own requests now went through the proxy,
  and every one of them failed with ERR_NO_SUPPORTED_PROXIES.
*/
describe('createProxyApplier and what Chromium takes', () => {
  it('gives Chromium the address without credentials and in its own scheme names', async () => {
    const def = target('default')
    const { apply } = setup([def])
    await apply('http://user@192.168.1.10:8080')
    await apply('socks5h://192.168.1.10:1080')
    expect(def.calls).toEqual([
      { proxyRules: 'http://192.168.1.10:8080' },
      { proxyRules: 'socks5://192.168.1.10:1080' }
    ])
  })

  it('reports where Chromium now sends a request, which carries no credentials', async () => {
    const def = target('default')
    const { apply, plans } = setup([def])
    await apply('http://user@192.168.1.10:8080')
    expect(def.probes).toEqual([PROBE_URL])
    expect(plans).toEqual([
      { plan: { rules: 'http://192.168.1.10:8080' }, resolved: 'PROXY 192.168.1.10:8080' }
    ])
  })

  it('keeps the system network for a SOCKS proxy with a password, and says why', async () => {
    const def = target('default')
    const { apply, plans } = setup([def])
    await apply('socks5://user@192.168.1.10:1080')
    expect(def.calls).toEqual([{ mode: 'system' }])
    expect(plans[0].plan).toEqual({ rules: '', caveat: 'socksAuth' })
  })

  it('falls back to the system network when Chromium did not take the rules', async () => {
    const def = target('default', undefined, () => '')
    const { apply, applied, refused } = setup([def])
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toEqual([{ proxyRules: 'http://192.168.1.10:8080' }, { mode: 'system' }])
    expect(refused).toEqual(['default: '])
    // Not "now go through the proxy".
    expect(applied).toEqual([])
  })

  it('takes DIRECT for the same refusal', async () => {
    const def = target('default', undefined, () => 'DIRECT')
    const { apply, refused } = setup([def])
    await apply('http://192.168.1.10:8080')
    expect(refused).toEqual(['default: DIRECT'])
  })

  it('does not apply refused rules again on every unrelated settings change', async () => {
    const def = target('default', undefined, () => '')
    const { apply, refused } = setup([def])
    await apply('http://192.168.1.10:8080')
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toHaveLength(2)
    expect(refused).toHaveLength(1)
  })
})
