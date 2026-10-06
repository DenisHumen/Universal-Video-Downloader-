import { session, type Session } from 'electron'
import { log } from './log'
import { browsingSession } from '../resolvers/universal/capture'
import { createProxyApplier, type ProxyTarget } from './proxy-queue'
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
 * Two sessions, and both are set. `net` uses the default one. The hidden
 * detection windows and the built-in browser load pages into a partition of
 * their own, which shares nothing with the default session - this used to say
 * otherwise, and those two went out directly from the user's own address
 * whatever was set here. That defeats a proxy used for privacy and fails
 * outright on a network that only works through one. Where the proxy gets
 * round a regional block, the sniffer caught a stream URL signed for the
 * user's real address, which yt-dlp then fetched through the proxy's - and a
 * CDN that binds its token to the address answers that with 403.
 *
 * Chromium is given the address in a form it understands (see
 * `chromiumProxy`), without the credentials; `proxy-auth.ts` answers the
 * proxy's 407 with them. An empty setting means "the system's own", which is
 * what a fresh Electron session already does.
 */
function target(name: string, get: () => Session): ProxyTarget {
  return {
    name,
    setProxy: (config) => get().setProxy(config),
    resolveProxy: (url) => get().resolveProxy(url)
  }
}

const apply = createProxyApplier(
  () => [target('default', () => session.defaultSession), target('browsing', browsingSession)],
  {
    applied: (plan, resolved) => {
      if (plan.caveat === 'socksAuth') {
        log.warn(
          'network',
          'Chromium cannot sign in to a SOCKS proxy, so own requests and the built-in browser use' +
            ' the system network. Downloads still go through the proxy.'
        )
      } else if (plan.rules) {
        log.info('network', 'Own requests and the built-in browser now go through the proxy', {
          via: resolved,
          note:
            plan.caveat === 'socks4a'
              ? 'socks4a is applied as socks4 here, so site names are resolved on this computer'
              : undefined
        })
      } else {
        log.info('network', 'Own requests and the built-in browser use the system network')
      }
    },
    failed: (name, why) => log.warn('network', 'Could not apply the proxy', { session: name, why }),
    refused: (name, resolved) =>
      log.warn(
        'network',
        'Chromium did not take the proxy address, so own requests use the system network.' +
          ' Downloads still go through the proxy.',
        { session: name, resolved: resolved || 'nothing' }
      )
  }
)

export function applyProxy(settings: Pick<AppSettings, 'proxy'>): Promise<void> {
  return apply(settings.proxy)
}
