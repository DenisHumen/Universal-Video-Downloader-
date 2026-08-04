import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Minus,
  RotateCw,
  Radio,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type { BrowserMedia, BrowserState } from '@shared/types'
import Toasts from './components/Toasts'
import Logo from './components/Logo'
import { toast } from './lib/toast'
import { applyAppearance } from './lib/theme'
import { useT } from './i18n'

const PANEL_WIDTH = 320

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
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const [settings, info] = await Promise.all([window.api.getSettings(), window.api.getAppInfo()])
      applyAppearance(settings, info.locale)
      setIsMac(info.platform === 'darwin')
    })()
    const offState = window.api.onBrowserState(setState)
    const offMedia = window.api.onBrowserMedia(setMedia)
    void window.api.browserRefreshState()
    return () => {
      offState()
      offMedia()
    }
  }, [])

  // Keep the address bar in step with real navigation, but never fight typing.
  useEffect(() => {
    if (!editing) setAddress(state.url)
  }, [state.url, editing])

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

      <header
        className="drag-region relative z-30 flex h-11 shrink-0 items-center justify-between border-b border-fg/[0.06] bg-ink-900"
        style={{ paddingLeft: isMac ? 80 : 14, paddingRight: 10 }}
      >
        <div className="flex items-center gap-2.5">
          <Logo className="h-5 w-5" />
          <span className="mono text-[13px] font-semibold tracking-tight text-cream">
            {t('browser.title')}
          </span>
        </div>
        {!isMac && (
          <div className="flex items-center gap-1">
            <button className="btn-icon" onClick={() => window.api.minimizeWindow()} aria-label="Minimize">
              <Minus size={16} />
            </button>
            <button className="btn-icon" onClick={() => window.api.maximizeWindow()} aria-label="Maximize">
              <Square size={12} />
            </button>
            <button
              className="no-drag inline-flex h-9 w-9 items-center justify-center rounded-xl text-fg/70 transition-all hover:bg-red-500/80 hover:text-white active:scale-95"
              onClick={() => window.api.closeWindow()}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>

      {/* Navigation bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-fg/[0.06] bg-ink-900 px-3 py-2">
        <button
          className="btn-icon"
          title={t('browser.back')}
          disabled={!state.canGoBack}
          onClick={() => window.api.browserBack()}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="btn-icon"
          title={t('browser.forward')}
          disabled={!state.canGoForward}
          onClick={() => window.api.browserForward()}
        >
          <ArrowRight size={16} />
        </button>
        <button
          className="btn-icon"
          title={state.loading ? t('browser.stop') : t('browser.reload')}
          onClick={() => (state.loading ? window.api.browserStop() : window.api.browserReload())}
        >
          {state.loading ? <X size={16} /> : <RotateCw size={16} />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-fg/[0.08] bg-ink-850 px-3 py-1.5 transition-colors focus-within:border-accent/40">
          {state.loading && <Loader2 size={13} className="shrink-0 animate-spin text-fg/55" />}
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
            className="no-drag min-w-0 flex-1 bg-transparent py-1 text-xs text-cream placeholder:text-fg/50 outline-none"
          />
        </div>

        <button
          className={state.picking ? 'btn-primary px-3 py-2 text-xs' : 'btn-ghost px-3 py-2 text-xs'}
          title={t('browser.pickHint')}
          onClick={() => window.api.browserSetPick(!state.picking)}
        >
          <Crosshair size={14} />
          {state.picking ? t('browser.pickActive') : t('browser.pick')}
        </button>
        <button
          className="btn-icon"
          title={t('browser.openExternal')}
          onClick={() => state.url && window.api.openExternal(state.url)}
        >
          <ExternalLink size={15} />
        </button>
      </div>

      {/* Page + media panel */}
      <div className="relative flex min-h-0 flex-1">
        {/* The native view is painted over this element by the main process. */}
        <div ref={stageRef} className="min-w-0 flex-1 bg-ink-950" />

        <aside
          className="flex shrink-0 flex-col border-l border-fg/[0.06] bg-ink-900"
          style={{ width: PANEL_WIDTH }}
        >
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <p className="group-title mb-0">{t('browser.found')}</p>
            {media.length > 0 && (
              <button
                className="btn-icon h-7 w-7"
                title={t('browser.clear')}
                onClick={() => window.api.browserClearMedia()}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
            <AnimatePresence initial={false}>
              {media.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl border border-fg/[0.06] bg-ink-850 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-fg/50">
                      {entry.kind === 'hls' || entry.kind === 'dash' ? (
                        <Radio size={13} />
                      ) : (
                        <Film size={13} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-cream" title={entry.url}>
                        {entry.label}
                      </p>
                      <p className="mono mt-0.5 text-[10px] uppercase text-fg/50">{entry.kind}</p>
                    </div>
                  </div>
                  <button
                    className={`btn mt-2.5 w-full py-1.5 text-[11px] ${
                      queued.has(entry.id) ? 'bg-good/15 text-good' : 'btn-primary'
                    }`}
                    disabled={queued.has(entry.id)}
                    onClick={() => download({ mediaId: entry.id }, entry.id)}
                  >
                    <Download size={12} />
                    {queued.has(entry.id) ? t('search.queued') : t('common.download')}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {media.length === 0 && (
              <div className="px-1 py-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-fg/[0.03] text-fg/35">
                  <Film size={22} />
                </div>
                <p className="mt-3 text-xs font-medium text-fg/50">{t('browser.foundNone')}</p>
                <p className="mono mt-1 text-[10px] leading-relaxed text-fg/50">
                  {t('browser.foundHint')}
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-fg/[0.06] p-3">
            <button
              className="btn-ghost w-full py-2 text-xs"
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
