import { describe, expect, it } from 'vitest'
import { createProxyApplier, proxyConfig, type ProxyConfig, type ProxyTarget } from './proxy-queue'

/*
  The proxy reached only the default session, so the built-in browser and the
  hidden detection windows went out directly whatever was set. And because the
  guard was written only after `setProxy` resolved, the two calls a launch makes
  in the same tick both went through, and every prefix of a proxy being typed
  was applied in turn.
*/

interface Fake extends ProxyTarget {
  calls: ProxyConfig[]
}

function target(name: string, fail?: (config: ProxyConfig) => boolean): Fake {
  const calls: ProxyConfig[] = []
  return {
    name,
    calls,
    setProxy: async (config) => {
      calls.push(config)
      if (fail?.(config)) throw new Error(`${name} refused`)
    }
  }
}

function setup(targets: Fake[]): {
  apply: (proxy: string | undefined) => Promise<void>
  applied: string[]
  failed: string[]
} {
  const applied: string[] = []
  const failed: string[] = []
  const apply = createProxyApplier(() => targets, {
    applied: (rules) => applied.push(rules),
    failed: (name, why) => failed.push(`${name}: ${why}`)
  })
  return { apply, applied, failed }
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
      { applied: (rules) => applied.push(rules), failed: (name, why) => failed.push(`${name}: ${why}`) }
    )
    await apply('http://192.168.1.10:8080')
    expect(failed).toEqual(['all: not ready'])

    ready = true
    await apply('http://192.168.1.10:8080')
    expect(def.calls).toHaveLength(1)
    expect(applied).toEqual(['http://192.168.1.10:8080'])
  })
})
