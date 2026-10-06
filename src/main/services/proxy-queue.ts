import { chromiumProxy, tookRules, type ChromiumProxy } from './proxy-rules'

/**
 * The part of applying the proxy that can be decided without Electron: which
 * value to apply, to whom, and in what order.
 */

/** What `Session.setProxy` is given: the user's rules, or the system's own. */
export type ProxyConfig = { proxyRules: string } | { mode: 'system' }

export function proxyConfig(rules: string): ProxyConfig {
  return rules ? { proxyRules: rules } : { mode: 'system' }
}

/** Any address will do: it only asks Chromium which way it would go. */
export const PROBE_URL = 'https://example.com'

/** A session the proxy has to reach, named so a refusal can say which one. */
export interface ProxyTarget {
  name: string
  setProxy(config: ProxyConfig): Promise<void>
  resolveProxy(url: string): Promise<string>
}

export interface ProxyReport {
  /** `resolved` is Chromium's own answer - `PROXY host:port`, never credentials. */
  applied(plan: ChromiumProxy, resolved: string): void
  failed(target: string, why: string): void
  /** Chromium took the call but not the rules; that session is back on the system network. */
  refused(target: string, resolved: string): void
}

class Refused extends Error {
  constructor(readonly resolved: string) {
    super('the rules were not taken')
  }
}

/**
 * Set, then ask Chromium where a request would go. A `setProxy` that resolves
 * proves nothing: rules it cannot parse are accepted and then match nothing,
 * which is how every request came to fail while the log said they went
 * through the proxy. Such a session is put back on the system network.
 */
async function applyTo(target: ProxyTarget, plan: ChromiumProxy): Promise<string> {
  await target.setProxy(proxyConfig(plan.rules))
  if (!plan.rules) return ''
  const resolved = await target.resolveProxy(PROBE_URL)
  if (tookRules(plan.rules, resolved)) return resolved.trim()
  await target.setProxy({ mode: 'system' })
  throw new Refused(resolved.trim())
}

/**
 * Applies the proxy to every target, one request at a time, newest wins.
 *
 * The value that has been *asked for* is recorded before anything is awaited.
 * The old guard compared against the value that had finished applying, which
 * is only known after `setProxy` resolves - so the two calls a launch makes,
 * a few lines apart in the same tick, both saw nothing applied yet, and both
 * went to Chromium and both wrote the line to the log. While someone typed a
 * proxy, every prefix of it was applied the same way: own requests briefly went
 * to a host called `h`, port 80.
 *
 * Calls queue behind each other rather than racing, and a queued one that a
 * newer request has overtaken is skipped: Chromium is never sent a value the
 * user has already moved past. A failure forgets the request, so saving the
 * same value again retries it instead of being taken for a no-op - but only if
 * nothing newer has been asked for in the meantime, because forgetting that
 * one would cancel it while it waits. Rules Chromium refused are not retried:
 * the same rules would be refused again, with another warning, on every
 * unrelated settings change.
 *
 * Targets are listed per call, not once: a session cannot be created before
 * the app is ready, and this module is loaded long before that.
 */
export function createProxyApplier(
  targets: () => ProxyTarget[],
  report: ProxyReport
): (proxy: string | undefined) => Promise<void> {
  let requested: string | null = null
  let chain: Promise<void> = Promise.resolve()

  return (proxy) => {
    const value = (proxy || '').trim()
    if (value === requested) return chain
    requested = value
    chain = chain.then(async () => {
      if (value !== requested) return
      let failed = false
      let refused = false
      let resolved = ''
      try {
        const list = targets()
        const plan = chromiumProxy(value)
        const results = await Promise.allSettled(list.map((target) => applyTo(target, plan)))
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            resolved ||= result.value
          } else if (result.reason instanceof Refused) {
            refused = true
            report.refused(list[i].name, result.reason.resolved)
          } else {
            failed = true
            report.failed(list[i].name, describe(result.reason))
          }
        })
        if (!failed && !refused) report.applied(plan, resolved)
      } catch (err) {
        // Nothing may reject this chain: every later call is queued behind it.
        failed = true
        report.failed('all', describe(err))
      }
      if (failed && requested === value) requested = null
    })
    return chain
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
