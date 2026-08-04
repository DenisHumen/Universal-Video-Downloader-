import { ipcRenderer } from 'electron'

/**
 * Preload for the *site* view inside the built-in browser.
 *
 * It exposes nothing to the page. It only adds an opt-in "pick" mode: while
 * active, hovering highlights elements and a click reports whatever media the
 * clicked element represents — a <video>'s current source, a player iframe, or
 * a link to another page — back to the main process. That's the escape hatch
 * for sites where automatic detection comes up empty: the user simply points
 * at the video.
 */

const CHANNEL_PICK = 'browser-site:pick'
const CHANNEL_MEDIA = 'browser-site:media'
const CHANNEL_SET_MODE = 'browser-site:set-pick-mode'

const OVERLAY_ID = '__uvd_pick_overlay__'
const HINT_ID = '__uvd_pick_hint__'

let picking = false
let overlay: HTMLDivElement | null = null
let hint: HTMLDivElement | null = null

function ensureOverlay(): HTMLDivElement {
  if (overlay && overlay.isConnected) return overlay
  overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: '2px solid #7c5cff',
    borderRadius: '6px',
    background: 'rgba(124, 92, 255, 0.16)',
    transition: 'all 60ms linear',
    display: 'none'
  } satisfies Partial<CSSStyleDeclaration>)
  document.documentElement.appendChild(overlay)
  return overlay
}

function ensureHint(): HTMLDivElement {
  if (hint && hint.isConnected) return hint
  hint = document.createElement('div')
  hint.id = HINT_ID
  Object.assign(hint.style, {
    position: 'fixed',
    left: '50%',
    top: '16px',
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    padding: '8px 14px',
    borderRadius: '999px',
    background: 'rgba(12, 12, 16, 0.92)',
    color: '#ededf2',
    font: '500 13px/1.2 -apple-system, Segoe UI, Roboto, sans-serif',
    boxShadow: '0 8px 30px rgba(0,0,0,0.45)'
  } satisfies Partial<CSSStyleDeclaration>)
  hint.textContent = 'Click the video you want · Esc to cancel'
  document.documentElement.appendChild(hint)
  return hint
}

function clearOverlay(): void {
  if (overlay) overlay.style.display = 'none'
  hint?.remove()
  hint = null
}

function highlight(el: Element): void {
  const box = el.getBoundingClientRect()
  const node = ensureOverlay()
  node.style.display = 'block'
  node.style.left = `${box.left}px`
  node.style.top = `${box.top}px`
  node.style.width = `${box.width}px`
  node.style.height = `${box.height}px`
}

interface PickResult {
  kind: 'video' | 'iframe' | 'link' | 'none'
  src?: string
  poster?: string
  title?: string
  pageUrl: string
}

function absolute(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url, document.baseURI).toString()
  } catch {
    return undefined
  }
}

/** Walk up from the clicked node looking for something that holds a video. */
function resolveTarget(start: Element | null): PickResult {
  const pageUrl = location.href
  let node: Element | null = start
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    if (node instanceof HTMLVideoElement) {
      const source = node.currentSrc || node.getAttribute('src') || undefined
      const nested = node.querySelector('source')
      return {
        kind: 'video',
        src: absolute(source || nested?.getAttribute('src')),
        poster: absolute(node.getAttribute('poster')),
        title: document.title,
        pageUrl
      }
    }
    if (node instanceof HTMLIFrameElement) {
      return {
        kind: 'iframe',
        src: absolute(node.getAttribute('src') || node.getAttribute('data-src')),
        title: document.title,
        pageUrl
      }
    }
    // A thumbnail in a listing: the anchor points at the real watch page.
    const video = node.querySelector?.('video')
    if (video instanceof HTMLVideoElement) {
      return {
        kind: 'video',
        src: absolute(video.currentSrc || video.getAttribute('src')),
        poster: absolute(video.getAttribute('poster')),
        title: document.title,
        pageUrl
      }
    }
    if (node instanceof HTMLAnchorElement && node.href) {
      return { kind: 'link', src: absolute(node.href), title: node.textContent?.trim(), pageUrl }
    }
  }
  return { kind: 'none', pageUrl }
}

function onMove(event: MouseEvent): void {
  if (!picking) return
  const el = event.target as Element | null
  if (el) highlight(el)
}

function onClick(event: MouseEvent): void {
  if (!picking) return
  event.preventDefault()
  event.stopPropagation()
  const result = resolveTarget(event.target as Element | null)
  setPicking(false)
  ipcRenderer.send(CHANNEL_PICK, result)
}

function onKey(event: KeyboardEvent): void {
  if (picking && event.key === 'Escape') {
    event.preventDefault()
    setPicking(false)
    ipcRenderer.send(CHANNEL_PICK, { kind: 'none', pageUrl: location.href } satisfies PickResult)
  }
}

function setPicking(next: boolean): void {
  picking = next
  if (next) {
    ensureOverlay()
    ensureHint()
    document.documentElement.style.cursor = 'crosshair'
  } else {
    clearOverlay()
    document.documentElement.style.cursor = ''
  }
}

ipcRenderer.on(CHANNEL_SET_MODE, (_e, enabled: boolean) => setPicking(Boolean(enabled)))

window.addEventListener('mousemove', onMove, true)
window.addEventListener('click', onClick, true)
window.addEventListener('keydown', onKey, true)

/**
 * Report the sources the page already exposes. The network capture in the main
 * process sees far more, but a `<video>` playing a blob: URL only ever reveals
 * its real source here.
 */
function reportDomMedia(): void {
  const found: { src: string; poster?: string }[] = []
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const src = v.currentSrc || v.getAttribute('src')
    if (src && /^https?:/i.test(src)) {
      found.push({ src, poster: absolute(v.getAttribute('poster')) })
    }
    for (const s of Array.from(v.querySelectorAll('source'))) {
      const nested = absolute(s.getAttribute('src'))
      if (nested && /^https?:/i.test(nested)) found.push({ src: nested })
    }
  }
  if (found.length) {
    ipcRenderer.send(CHANNEL_MEDIA, { items: found, pageUrl: location.href, title: document.title })
  }
}

window.addEventListener('DOMContentLoaded', () => {
  reportDomMedia()
  setInterval(reportDomMedia, 2500)
})
