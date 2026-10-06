import { app, type ClientRequest } from 'electron'
import type { AppSettings } from '@shared/types'
import { withProxyPassword } from '@shared/proxy'
import { describeProxyRefusal } from '../resolvers/neterror'
import { getSettings } from './settings'
import { getSecret, SECRET } from './secrets'
import { createProxyLogin, proxyCredentials, type ProxyCredentials } from './proxy-rules'

/**
 * The proxy's password, put back where it is needed and nowhere else.
 *
 * It is kept in the secret store, out of settings.json, and Chromium is given
 * the address without it (it takes none). What remains is answering the 407
 * an authenticated proxy sends, which nothing did, so every request through
 * such a proxy failed.
 *
 * Its own file so the resolvers can use it: `proxy.ts` reaches the browsing
 * session, which imports the resolvers' http module.
 */

function current(): ProxyCredentials | undefined {
  return proxyCredentials(getSettings().proxy, getSecret(SECRET.proxyPassword()))
}

/** The whole address, password included, for the engine. Never stored, never logged. */
export function proxyUrl(settings: Pick<AppSettings, 'proxy'>): string {
  return withProxyPassword(settings.proxy, getSecret(SECRET.proxyPassword()))
}

/**
 * Every `net.request` the app makes goes through this; `url` is only for the
 * error it may raise.
 *
 * A proxy challenge this does not answer is abandoned with `abort()`, never
 * declined with `callback()`. In Electron 33, declining a proxy's second
 * challenge stalled the whole main process - two seconds in one run, half a
 * minute in another, for good when `clearAuthCache` came next - and with no
 * listener at all, the next request through the proxy never finished. The
 * window froze while it lasted. Aborting stalls nothing, so the request is
 * aborted and its owner is handed the reason as an ordinary 'error'.
 *
 * A site's own login is declined as before; that path never stalled, and the
 * site's 401 comes back as the response it always was.
 */
export function withProxyAuth(request: ClientRequest, url: string): ClientRequest {
  const decide = createProxyLogin(current)
  request.on('login', (authInfo, callback) => {
    const decision = decide(authInfo)
    if (decision.kind === 'answer') {
      callback(decision.username, decision.password)
      return
    }
    if (decision.kind === 'site') {
      callback()
      return
    }
    request.abort()
    if (request.listenerCount('error') > 0) {
      request.emit('error', describeProxyRefusal(url, decision.kind === 'unknown'))
    }
  })
  return request
}

/**
 * The same for pages: the built-in browser and the hidden detection windows
 * load through the proxy too. Left alone, Electron cancels the challenge,
 * which for a page stalls nothing; so only the challenges this answers are
 * taken over.
 */
export function answerProxyLoginsForPages(): void {
  const decide = createProxyLogin(current)
  app.on('login', (event, webContents, details, authInfo, callback) => {
    const decision = decide(authInfo, `${webContents?.id} ${details.url}`)
    if (decision.kind !== 'answer') return
    event.preventDefault()
    callback(decision.username, decision.password)
  })
}
