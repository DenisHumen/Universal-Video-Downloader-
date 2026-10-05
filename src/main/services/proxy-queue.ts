/**
 * The part of applying the proxy that can be decided without Electron: which
 * value to apply, to whom, and in what order.
 */

/** What `Session.setProxy` is given: the user's rules, or the system's own. */
export type ProxyConfig = { proxyRules: string } | { mode: 'system' }

export function proxyConfig(rules: string): ProxyConfig {
  return rules ? { proxyRules: rules } : { mode: 'system' }
}

/** A session the proxy has to reach, named so a refusal can say which one. */
export interface ProxyTarget {
  name: string
  setProxy(config: ProxyConfig): Promise<void>
}

export interface ProxyReport {
  applied(rules: string): void
  failed(target: string, why: string): void
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
 * one would cancel it while it waits.
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
    const rules = (proxy || '').trim()
    if (rules === requested) return chain
    requested = rules
    chain = chain.then(async () => {
      if (rules !== requested) return
      let failed = false
      try {
        const list = targets()
        const config = proxyConfig(rules)
        const results = await Promise.allSettled(list.map((target) => target.setProxy(config)))
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') return
          failed = true
          report.failed(list[i].name, describe(result.reason))
        })
      } catch (err) {
        // Nothing may reject this chain: every later call is queued behind it.
        failed = true
        report.failed('all', describe(err))
      }
      if (!failed) report.applied(rules)
      else if (requested === rules) requested = null
    })
    return chain
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
