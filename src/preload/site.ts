import { contextBridge, ipcRenderer } from 'electron'

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

/*
  On Google's sign-in page the browser says it is Firefox (see
  browser-identity.ts in the main process), and Firefox has no
  navigator.userAgentData. Chromium's would still name Chromium, so it goes,
  before any of the page's own scripts can read it.
*/
if (location.protocol === 'https:' && /^accounts\.(google|youtube)\.com$/.test(location.hostname)) {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        delete (Navigator.prototype as { userAgentData?: unknown }).userAgentData
      }
    })
  } catch {
    /* an older page world: the headers alone still say Firefox */
  }
}

const CHANNEL_PICK = 'browser-site:pick'
const CHANNEL_MEDIA = 'browser-site:media'
const CHANNEL_SET_MODE = 'browser-site:set-pick-mode'

const OVERLAY_ID = '__uvd_pick_overlay__'
const HINT_ID = '__uvd_pick_hint__'

let picking = false
let overlay: HTMLDivElement | null = null
let hint: HTMLDivElement | null = null
/*
  This preload runs inside the *site*, not the app, so it has no dictionary of
  its own — and the one sentence it draws was therefore in English however the
  interface was set. The main process sends the wording along with the mode.
*/
let hintText = 'Click the video you want · Esc to cancel'

function ensureOverlay(): HTMLDivElement {
  if (overlay && overlay.isConnected) return overlay
  overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    /* The system's one saturated colour: Yaru orange, as the app's accent. */
    border: '2px solid #e95420',
    borderRadius: '6px',
    background: 'rgba(233, 84, 32, 0.16)',
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
  hint.textContent = hintText
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

ipcRenderer.on(CHANNEL_SET_MODE, (_e, enabled: boolean, text?: string) => {
  if (text) hintText = text
  setPicking(Boolean(enabled))
})

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

/*
  Passwords.

  When a password is sent - a form submitted, Enter in a password box, a click
  on the button beside it - the login is reported so the browser can offer to
  keep it. The main process decides whether to ask, and takes the site from
  the frame that sent this, never from anything the page says. When main has a
  login for the site it sends it back, and it is typed into the first password
  form that appears, without submitting anything.
*/
const CHANNEL_LOGIN = 'browser-site:login'
const CHANNEL_FILL = 'browser-site:fill'

function visible(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function passwordFields(root: ParentNode = document): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(visible)
}

/** The username box that goes with a password box: the last text-like field before it. */
function usernameFor(password: HTMLInputElement): HTMLInputElement | undefined {
  const scope: ParentNode = password.form ?? document
  const fields = Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="username"], input[type="email"], input[type="text"], input[type="tel"], input:not([type])'
    )
  ).filter(visible)
  const tagged = fields.find((f) => f.autocomplete === 'username')
  if (tagged) return tagged
  const before = fields.filter(
    (f) => f.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING
  )
  return before[before.length - 1] ?? fields[0]
}

let lastSent = ''
function reportLogin(password: HTMLInputElement | undefined): void {
  if (!password || !password.value) return
  // A new-password box on a sign-up or change form is still the password to keep.
  const username = usernameFor(password)?.value.trim() ?? ''
  const key = username + '\u0000' + password.value
  if (key === lastSent) return
  lastSent = key
  ipcRenderer.send(CHANNEL_LOGIN, { username, password: password.value })
}

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target as HTMLFormElement | null
    if (form) reportLogin(passwordFields(form).pop())
  },
  true
)
document.addEventListener(
  'keydown',
  (event) => {
    const el = event.target as HTMLInputElement | null
    if (event.key === 'Enter' && el?.type === 'password') reportLogin(el)
  },
  true
)
document.addEventListener(
  'click',
  (event) => {
    const button = (event.target as Element | null)?.closest?.('button, input[type="submit"], [role="button"]')
    if (!button) return
    const filled = passwordFields().filter((p) => p.value)
    if (filled.length) reportLogin(filled[filled.length - 1])
  },
  true
)

/** Type into a field the way a person would, so frameworks that watch input see it. */
function typeInto(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

let pendingFill: { username: string; password: string } | null = null
let fillObserver: MutationObserver | null = null

function tryFill(): boolean {
  if (!pendingFill) return true
  const password = passwordFields().find((p) => !p.value && p.autocomplete !== 'new-password')
  const user = password ? usernameFor(password) : undefined
  // A two-step sign-in shows the username first, on its own.
  const loneUser =
    !password &&
    document.querySelector<HTMLInputElement>('input[autocomplete="username"], input[type="email"]')
  if (password) {
    if (user && !user.value && pendingFill.username) typeInto(user, pendingFill.username)
    typeInto(password, pendingFill.password)
    lastSent = (pendingFill.username || '') + '\u0000' + pendingFill.password
    pendingFill = null
    return true
  }
  if (loneUser && visible(loneUser) && !loneUser.value && pendingFill.username) {
    typeInto(loneUser, pendingFill.username)
  }
  return false
}

ipcRenderer.on(CHANNEL_FILL, (_e, login: { username: string; password: string }) => {
  pendingFill = login
  if (tryFill()) return
  fillObserver?.disconnect()
  fillObserver = new MutationObserver(() => {
    if (tryFill()) {
      fillObserver?.disconnect()
      fillObserver = null
    }
  })
  fillObserver.observe(document.documentElement, { childList: true, subtree: true })
  // Not forever: a page with no sign-in form has no use for the password.
  setTimeout(() => {
    fillObserver?.disconnect()
    fillObserver = null
    pendingFill = null
  }, 60_000)
})
