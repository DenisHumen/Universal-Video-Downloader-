import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Download,
  ExternalLink,
  Loader2,
  RotateCw,
  Trash2,
  X
} from './ui/icons'
import type { BrowserLoginOffer, BrowserMedia, BrowserState } from '@shared/types'
import { Banner, ToastViewport as Toasts } from './ui'
import IconButton from './ui/IconButton'
import Logo from './components/Logo'
import CaptionButtons from './components/CaptionButtons'
import { enter } from './lib/motion'
import { toast } from './lib/toast'
import { formatBytes } from './lib/format'
import { applyAppearance } from './lib/theme'
import { useStore } from './store'
import { t as tNow, useT } from './i18n'

const PANEL_WIDTH = 300

/**
 * Shell for the built-in browser window.
 *
 * The page itself is a native WebContentsView owned by the main process — this
 * renderer only draws the chrome around it and tells main where to put it. That
 * keeps the site fully isolated from the app while still letting us watch every
 * request it makes.
 */
export default function BrowserApp(): JSX.Element {
  const t = useT()
  const [state, setState] = useState<BrowserState>({
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    picking: false
  })
  const [media, setMedia] = useState<BrowserMedia[]>([])
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [queued, setQueued] = useState<Set<string>>(new Set())
  const [isMac, setIsMac] = useState(false)
  const [offer, setOffer] = useState<BrowserLoginOffer | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const [settings, info] = await Promise.all([window.api.getSettings(), window.api.getAppInfo()])
      applyAppearance(settings, info.locale, info.systemAccent)
      setIsMac(info.platform === 'darwin')
      // The caption buttons read the platform and GNOME's button order from the store.
      useStore.setState({ appInfo: info })
    })()
    const offState = window.api.onBrowserState(setState)
    const offMedia = window.api.onBrowserMedia(setMedia)
    /*
      A video the page offered as a download goes to the queue, not to a Save
      dialog. The non-reactive lookup: this effect runs once, and `t` from the
      hook would answer in whatever language was set before settings loaded.
    */
    const offQueued = window.api.onBrowserQueued(() => toast(tNow('browser.queued'), 'success'))
    const offOffer = window.api.onBrowserLoginOffer(setOffer)
    void window.api.browserRefreshState()
    return () => {
      offState()
      offMedia()
      offQueued()
      offOffer()
    }
  }, [])

  // Keep the address bar in step with real navigation, but never fight typing.
  useEffect(() => {
    if (!editing) setAddress(state.url)
  }, [state.url, editing])

  /*
    Forget what was queued when the page changes.

    `queued` marks entries the user has already sent to the queue so the button
    reads "queued" instead of inviting a duplicate. It was only ever added to —
    and one of its keys is the literal 'page', not an id. So after downloading
    a page once, "download this page" stayed disabled for every page visited
    afterwards, for the rest of the session. The media list is cleared on
    navigation for exactly this reason; its markers have to go with it.
  */
  useEffect(() => {
    setQueued(new Set())
  }, [state.url])

  // The native view is positioned in window coordinates, so it has to be told
  // where our layout left room for it — on every resize, not just at start.
  useLayoutEffect(() => {
    const report = (): void => {
      const node = stageRef.current
      if (!node) return
      const box = node.getBoundingClientRect()
      void window.api.browserSetBounds({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height
      })
    }
    report()
    window.addEventListener('resize', report)
    const observer = new ResizeObserver(report)
    if (stageRef.current) observer.observe(stageRef.current)
    return () => {
      window.removeEventListener('resize', report)
      observer.disconnect()
    }
  }, [])

  const answer = (choice: 'save' | 'never' | 'dismiss'): void => {
    setOffer(null)
    void window.api.browserLoginAnswer(choice).then(() => {
      if (choice === 'save') toast(t('browser.loginSaved'), 'success')
    })
  }

  const go = (): void => {
    setEditing(false)
    void window.api.browserNavigate(address)
  }

  const download = async (target: { mediaId?: string; url?: string }, key: string): Promise<void> => {
    const item = await window.api.browserDownload(target)
    if (!item) return
    setQueued((prev) => new Set(prev).add(key))
    toast(t('browser.queued'), 'success')
  }

  return (
    <>
      <Toasts />

      {/*
        Chrome and navigation share one 48px rule, same as the main window, and
        off the Mac it has no right padding so the caption buttons reach the
        corner.
      */}
      <header
        className={`drag-region relative flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-canvas ${isMac ? 'pr-2' : ''}`}
        style={{ zIndex: 'var(--z-chrome)', paddingLeft: isMac ? 76 : 12 }}
      >
        <div className="flex shrink-0 items-center gap-2.5 pr-1">
          <Logo className="h-[18px] w-[18px] text-ink" />
          <span className="hidden text-heading text-ink sm:inline">
            {t('browser.title')}
          </span>
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t('browser.back')}
            icon={<ArrowLeft size={16} />}
            disabled={!state.canGoBack}
            onClick={() => window.api.browserBack()}
          />
          <IconButton
            label={t('browser.forward')}
            icon={<ArrowRight size={16} />}
            disabled={!state.canGoForward}
            onClick={() => window.api.browserForward()}
          />
          <IconButton
            label={state.loading ? t('browser.stop') : t('browser.reload')}
            icon={state.loading ? <X size={16} /> : <RotateCw size={16} />}
            onClick={() => (state.loading ? window.api.browserStop() : window.api.browserReload())}
          />
        </div>

        <label className="field flex min-w-0 flex-1 cursor-text items-center gap-2 px-3 py-1.5">
          {state.loading && <Loader2 size={12} className="shrink-0 animate-spin text-ink-3" />}
          <input
            value={address}
            onChange={(e) => {
              setEditing(true)
              setAddress(e.target.value)
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder={t('browser.urlPlaceholder')}
            spellCheck={false}
            className="no-drag mono min-w-0 flex-1 self-stretch bg-transparent text-control text-ink outline-none placeholder:text-ink/80"
          />
        </label>

        <button
          className={`shrink-0 px-3 py-2 ${state.picking ? 'btn-solid' : 'btn-quiet'}`}
          title={t('browser.pickHint')}
          onClick={() => window.api.browserSetPick(!state.picking)}
        >
          <Crosshair size={14} />
          {state.picking ? t('browser.pickActive') : t('browser.pick')}
        </button>
        <IconButton
          label={t('browser.openExternal')}
          icon={<ExternalLink size={16} />}
          onClick={() => state.url && window.api.openExternal(state.url)}
        />

        {!isMac && <CaptionButtons />}
      </header>

      {/*
        AdwBanner under the header bar, as GNOME Web asks. The page moves down
        for it rather than being covered: the stage below re-reports its box.
      */}
      {offer && (
        <Banner
          title={
            offer.username
              ? t(offer.update ? 'browser.loginUpdate' : 'browser.loginSave', {
                  user: offer.username,
                  site: offer.site
                })
              : t('browser.loginSaveSite', { site: offer.site })
          }
          action={
            <div className="flex shrink-0 items-center gap-1.5">
              <button className="btn-quiet" onClick={() => answer('never')}>
                {t('browser.loginNever')}
              </button>
              <button className="btn-quiet" onClick={() => answer('dismiss')}>
                {t('browser.loginNotNow')}
              </button>
              <button className="btn-solid" onClick={() => answer('save')}>
                {offer.update ? t('browser.loginUpdateButton') : t('browser.loginSaveButton')}
              </button>
            </div>
          }
        />
      )}

      {/* Page + the streams found on it */}
      <div className="relative flex min-h-0 flex-1">
        {/* The native view is painted over this element by the main process. */}
        <div ref={stageRef} className="min-w-0 flex-1 bg-canvas" />

        <aside
          className="flex shrink-0 flex-col border-l border-edge bg-canvas"
          style={{ width: PANEL_WIDTH }}
        >
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <p className="label">{t('browser.found')}</p>
            {media.length > 0 && (
              <IconButton label={t('browser.clear')} icon={<Trash2 size={16} />} onClick={() => window.api.browserClearMedia()} />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence initial={false}>
              {media.map((entry) => (
                <m.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={enter}
                  className="border-b border-edge px-4 py-3"
                >
                  <p className="truncate text-control font-medium text-ink" title={entry.url}>
                    {entry.label}
                  </p>
                  <p className="mt-1 text-meta font-bold text-ink-2">
                    {[entry.kind, entry.bytes ? formatBytes(entry.bytes) : null]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </p>
                  <button
                    className={`mt-2.5 w-full py-2 ${
                      queued.has(entry.id) ? 'btn-base bg-good/12 text-good' : 'btn-quiet'
                    }`}
                    disabled={queued.has(entry.id)}
                    onClick={() => download({ mediaId: entry.id }, entry.id)}
                  >
                    {queued.has(entry.id) ? <Check size={12} /> : <Download size={12} />}
                    {queued.has(entry.id) ? t('search.queued') : t('common.download')}
                  </button>
                </m.div>
              ))}
            </AnimatePresence>

            {media.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-control font-medium text-ink">{t('browser.foundNone')}</p>
                <p className="hint mt-2">
                  {t('browser.foundHint')}
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-edge p-3">
            <button
              className="btn-quiet w-full py-2.5"
              disabled={!state.url || queued.has('page')}
              onClick={() => download({ url: state.url }, 'page')}
            >
              <Download size={13} /> {t('browser.downloadPage')}
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}
