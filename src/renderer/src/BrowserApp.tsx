import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Download,
  ExternalLink,
  Loader2,
  Minus,
  RotateCw,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type { BrowserMedia, BrowserState } from '@shared/types'
import Toasts from './components/Toasts'
import Logo from './components/Logo'
import { enter } from './lib/motion'
import { toast } from './lib/toast'
import { applyAppearance } from './lib/theme'
import { useT } from './i18n'

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

      {/* Chrome and navigation share one 48px rule, same as the main window. */}
      <header
        className="drag-region relative flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-canvas pr-2"
        style={{ zIndex: 'var(--z-chrome)', paddingLeft: isMac ? 76 : 12 }}
      >
        <div className="flex shrink-0 items-center gap-2.5 pr-1">
          <Logo className="h-[18px] w-[18px] text-ink" />
          <span className="mono hidden text-[12px] font-semibold uppercase tracking-[0.16em] text-ink sm:inline">
            {t('browser.title')}
          </span>
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <button
            className="btn-icon"
            title={t('browser.back')} aria-label={t('browser.back')}
            disabled={!state.canGoBack}
            onClick={() => window.api.browserBack()}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="btn-icon"
            title={t('browser.forward')} aria-label={t('browser.forward')}
            disabled={!state.canGoForward}
            onClick={() => window.api.browserForward()}
          >
            <ArrowRight size={15} />
          </button>
          <button
            className="btn-icon"
            title={state.loading ? t('browser.stop') : t('browser.reload')} aria-label={state.loading ? t('browser.stop') : t('browser.reload')}
            onClick={() => (state.loading ? window.api.browserStop() : window.api.browserReload())}
          >
            {state.loading ? <X size={15} /> : <RotateCw size={15} />}
          </button>
        </div>

        <label className="field flex min-w-0 flex-1 cursor-text items-center gap-2 rounded-full px-3 py-1.5">
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
            className="no-drag mono min-w-0 flex-1 self-stretch bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
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
        <button
          className="btn-icon"
          title={t('browser.openExternal')} aria-label={t('browser.openExternal')}
          onClick={() => state.url && window.api.openExternal(state.url)}
        >
          <ExternalLink size={14} />
        </button>

        {!isMac && (
          <div className="ml-1 flex shrink-0 items-center">
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink"
              onClick={() => window.api.minimizeWindow()}
              aria-label="Minimize"
            >
              <Minus size={15} />
            </button>
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-sink hover:text-ink"
              onClick={() => window.api.maximizeWindow()}
              aria-label="Maximize"
            >
              <Square size={11} />
            </button>
            <button
              className="no-drag inline-flex h-8 w-9 cursor-pointer items-center justify-center text-ink-3 transition-colors duration-fast ease-ease hover:bg-bad hover:text-white"
              onClick={() => window.api.closeWindow()}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>

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
              <button className="btn-icon" title={t('browser.clear')} aria-label={t('browser.clear')} onClick={() => window.api.browserClearMedia()}>
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence initial={false}>
              {media.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={enter}
                  className="border-b border-edge px-4 py-3"
                >
                  <p className="truncate text-[13px] font-medium text-ink" title={entry.url}>
                    {entry.label}
                  </p>
                  <p className="mono mt-1 text-[11px] uppercase tracking-[0.08em] text-ink-2">
                    {entry.kind}
                  </p>
                  <button
                    className={`mt-2.5 w-full py-2 ${
                      queued.has(entry.id) ? 'btn bg-good/12 text-good' : 'btn-quiet'
                    }`}
                    disabled={queued.has(entry.id)}
                    onClick={() => download({ mediaId: entry.id }, entry.id)}
                  >
                    {queued.has(entry.id) ? <Check size={12} /> : <Download size={12} />}
                    {queued.has(entry.id) ? t('search.queued') : t('common.download')}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {media.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] font-medium text-ink">{t('browser.foundNone')}</p>
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
