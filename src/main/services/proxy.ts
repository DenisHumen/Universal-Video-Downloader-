import { session } from 'electron'
import { log } from './log'
import type { AppSettings } from '@shared/types'

/**
 * Point the app's own requests at the proxy the user set.
 *
 * Settings → Network has always been passed to the engine, so downloads and
 * searches went through the proxy. The app's own requests did not: the page a
 * link resolves to, the site's API, the player behind it, the update check -
 * all made with Electron's `net`, which follows the session's proxy and knew
 * nothing about this setting. On a network that only works through the proxy,
 * every download succeeded and every page failed with "connection refused",
 * which reads as the site being down rather than the app going the wrong way.
 *
 * Applied to the default session, which is what `net`, the hidden detection
 * windows and the built-in browser all share. An empty setting means "the
 * system's own", which is what a fresh Electron session already does.
 */
let applied: string | null = null

export async function applyProxy(settings: Pick<AppSettings, 'proxy'>): Promise<void> {
  const rules = (settings.proxy || '').trim()
  if (rules === applied) return
  try {
    await session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
    applied = rules
    log.info('network', rules ? 'Own requests now go through the proxy' : 'Own requests use the system network')
  } catch (err) {
    log.warn('network', 'Could not apply the proxy to own requests', {
      why: err instanceof Error ? err.message : String(err)
    })
  }
}
