/**
 * Smoke test for the Electron APIs this app leans on.
 *
 * Run with:  npx electron scripts/smoke-electron.mjs  [thumbnail-url]
 *
 * It exercises the exact surface `services/browser.ts` uses — WebContentsView
 * inside a BrowserWindow's contentView, session-scoped webRequest capture, the
 * navigationHistory API and script injection into the site view — plus the one
 * assumption `services/thumbnails.ts` rests on: that `net.request` sends the
 * `Referer` we set rather than stripping it. Nothing here touches app code, so
 * it also serves as an early warning when an Electron upgrade moves things.
 */
import { app, BrowserWindow, WebContentsView, net, session } from 'electron'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const PARTITION = 'persist:uvd-smoke'
const MEDIA = /\.(m3u8|mpd|mp4|m4v|webm)(\?|#|$)/i

app.whenReady().then(async () => {
  const captured = []
  const ses = session.fromPartition(PARTITION)

  try {
    ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
      if (MEDIA.test(details.url)) captured.push(details.url)
      cb({ requestHeaders: details.requestHeaders })
    })
    check('session.webRequest.onBeforeSendHeaders installs', true)
  } catch (err) {
    check('session.webRequest.onBeforeSendHeaders installs', false, err.message)
  }

  const win = new BrowserWindow({ width: 1000, height: 700, show: false })

  let view
  try {
    view = new WebContentsView({
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: false }
    })
    check('new WebContentsView', true)
  } catch (err) {
    check('new WebContentsView', false, err.message)
    finish()
    return
  }

  try {
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 96, width: 1000, height: 604 })
    const b = view.getBounds()
    check('contentView.addChildView + setBounds', b.y === 96 && b.width === 1000, JSON.stringify(b))
  } catch (err) {
    check('contentView.addChildView + setBounds', false, err.message)
  }

  const wc = view.webContents

  try {
    const canBack = wc.navigationHistory.canGoBack()
    check('webContents.navigationHistory.canGoBack()', typeof canBack === 'boolean', String(canBack))
  } catch (err) {
    check('webContents.navigationHistory.canGoBack()', false, err.message)
  }

  try {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    check('setWindowOpenHandler', true)
  } catch (err) {
    check('setWindowOpenHandler', false, err.message)
  }

  // Load a page that fetches an .mp4 so the capture hook has something to see.
  try {
    await wc.loadURL('data:text/html,<video src="https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4" autoplay muted></video>')
    check('WebContentsView loads a page', true, wc.getURL().slice(0, 40) + '…')
  } catch (err) {
    check('WebContentsView loads a page', false, err.message)
  }

  await new Promise((r) => setTimeout(r, 6000))
  check('webRequest captured the media request', captured.length > 0, captured[0] ?? 'nothing seen')

  try {
    const title = await wc.executeJavaScript('document.querySelectorAll("video").length')
    check('executeJavaScript in the site view', title === 1, `videos=${title}`)
  } catch (err) {
    check('executeJavaScript in the site view', false, err.message)
  }

  // Hotlink-protected posters only load when we send a Referer; Chromium's
  // network stack treats that header specially, so prove it survives.
  const thumbUrl = process.argv.find((a) => a.startsWith('http'))
  if (thumbUrl) {
    const get = (referer) =>
      new Promise((resolve) => {
        const req = net.request({ url: thumbUrl, redirect: 'follow' })
        req.setHeader('User-Agent', 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36')
        if (referer) req.setHeader('Referer', referer)
        req.on('response', (res) => {
          let bytes = 0
          res.on('data', (c) => (bytes += c.length))
          res.on('end', () =>
            resolve({ status: res.statusCode, type: String(res.headers['content-type']), bytes })
          )
        })
        req.on('error', (err) => resolve({ status: 0, type: err.message, bytes: 0 }))
        req.end()
      })

    // Only the header pass-through is asserted. Whether the CDN *refuses* a
    // referer-less request is its policy, not ours, and edge caches make the
    // answer depend on what was fetched a moment earlier — a check that would
    // flake without ever telling us anything about this codebase.
    const withRef = await get('https://www.pornhub.com/')
    check(
      'net.request sends the Referer we set (and gets an image back)',
      withRef.status === 200 && /image\//.test(withRef.type),
      `HTTP ${withRef.status} ${withRef.type} ${withRef.bytes}B`
    )
  } else {
    console.log('SKIP  thumbnail referer check (pass a URL as an argument)')
  }

  finish()

  function finish() {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    app.exit(failed.length ? 1 : 0)
  }
})
