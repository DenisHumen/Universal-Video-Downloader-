/**
 * Shared by capture-screenshots.mjs (README shots) and visual.mjs (the
 * visual-diff harness): the in-page driver both inject into the preview.
 */
/**
 * Injected into the page: a thin driver over the store and the mock bridge.
 *
 * Clicking through the UI with synthetic events is possible and fragile — a
 * renamed button silently produces a screenshot of the wrong screen. Driving
 * the store directly fails loudly instead.
 */
export const DRIVER = `
window.__uvdShotPoster = (seed, label) => {
  const hue = (seed * 47) % 360
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="480" y2="270" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="hsl(' + hue + ' 42% 30%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ' 38% 14%)"/>' +
    '</linearGradient></defs><rect width="480" height="270" fill="url(#g)"/>' +
    '<circle cx="240" cy="135" r="42" fill="rgba(255,255,255,0.14)"/>' +
    '<path d="M228 113 L268 135 L228 157 Z" fill="rgba(255,255,255,0.72)"/>' +
    '<text x="24" y="246" fill="rgba(255,255,255,0.55)" font-family="monospace" font-size="16">' + label + '</text></svg>'
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

window.__uvdShot = {
  async view(id) {
    const store = window.__uvdStore
    if (!store) throw new Error('store not exposed')
    store.getState().setView(id)
    // React renders on the next tick; the callers below reach straight into
    // the DOM of the view they just asked for.
    await new Promise((r) => setTimeout(r, 250))
  },
  async detect(url) {
    const input = document.getElementById('uvd-url')
    if (!input) throw new Error('no url field on screen')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, url)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const go = document.querySelector('[data-uvd="detect"]')
    if (!go) throw new Error('no detect button on screen')
    go.click()
    await new Promise((r) => setTimeout(r, 1600))
  },
  async search(query) {
    const input = document.getElementById('uvd-search')
    if (!input) throw new Error('no search field on screen')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const go = document.querySelector('[data-uvd="search"]')
    if (!go) throw new Error('no search button on screen')
    go.click()
    await new Promise((r) => setTimeout(r, 1800))
  },
  seedQueue() {
    const q = window.__uvdMock.queue
    q({
      id: 'shot-1',
      title: 'Big Buck Bunny — official 4K remaster',
      thumbnail: window.__uvdShotPoster(1, '4K'),
      state: 'downloading',
      percent: 62,
      targetHeight: 2160,
      speed: 8_400_000,
      eta: 94,
      downloadedBytes: 560_000_000,
      totalBytes: 900_000_000,
      phase: 'download'
    })
    q({
      id: 'shot-2',
      title: 'Sintel (2010) — 1080p',
      thumbnail: window.__uvdShotPoster(2, '1080p'),
      state: 'processing',
      percent: 93,
      targetHeight: 1080,
      phase: 'postprocess',
      postprocess: 'merge',
      indeterminate: true
    })
    q({
      id: 'shot-3',
      title: 'Tears of Steel — trailer (clip)',
      thumbnail: window.__uvdShotPoster(3, 'clip'),
      kind: 'trim',
      jobLabel: '00:01:12 → 00:02:40',
      state: 'queued',
      percent: 0
    })
    q({
      id: 'shot-4',
      title: 'Elephants Dream — 720p',
      thumbnail: window.__uvdShotPoster(4, '720p'),
      state: 'completed',
      percent: 100,
      targetHeight: 720,
      totalBytes: 240_000_000,
      filepath: 'C:\\\\Users\\\\demo\\\\Downloads\\\\Elephants Dream [ed].mp4'
    })
    // Finished on earlier days: in the Library, no longer in Activity (5.2).
    ;[
      ['shot-6', 'Cosmos Laundromat — first cycle', 1, 'mkv', 'vimeo', 610_000_000],
      ['shot-7', 'Spring — Blender Open Movie', 1, 'mp4', 'youtube', 180_000_000],
      ['shot-8', 'Agent 327: Operation Barbershop', 3, 'mp4', 'youtube', 320_000_000],
      ['shot-9', 'Caminandes 3: Llamigos', 9, 'webm', 'youtube', 64_000_000]
    ].forEach(([id, title, days, ext, site, size], n) =>
      q({
        id,
        title,
        thumbnail: window.__uvdShotPoster(6 + n, ext),
        state: 'completed',
        percent: 100,
        extractor: site,
        totalBytes: size,
        createdAt: Date.now() - days * 86400e3 - 3600e3,
        finishedAt: Date.now() - days * 86400e3,
        filepath: '/home/demo/Videos/' + title + '.' + ext
      })
    )
    q({
      id: 'shot-5',
      title: 'members-only-stream',
      state: 'error',
      percent: 0,
      errorCode: 'signIn',
      cookieHint: true
    })
  }
}
true
`
