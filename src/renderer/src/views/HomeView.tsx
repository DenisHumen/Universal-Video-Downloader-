import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { collapse, enter } from '../lib/motion'
import {
  ArrowRight,
  ChevronDown,
  ClipboardPaste,
  Folder,
  Globe,
  Layers,
  Loader2,
  RotateCw,
  Scissors,
  Search,
  X
} from 'lucide-react'
import {
  hasTrim,
  type AppErrorCode,
  type DetectResult,
  type DetectStage,
  type MediaInfo,
  type TrimRange
} from '@shared/types'
import { needsCookiesOften } from '@shared/urls'
import { useStore } from '../store'
import { errorText } from '../lib/errors'
import { formatCount, formatDuration, isProbablyUrl } from '../lib/format'
import {
  availableHeights,
  initialMode,
  initialQuality,
  maxHeightOf,
  resolveSelection
} from '../lib/quality'
import { queueDownload, queueDownloads } from '../lib/queue'
import { toClock } from '../lib/time'
import { useT, type TranslationKey } from '../i18n'
import FormatSelector, { type Selection } from '../components/FormatSelector'
import PlaylistCard from '../components/PlaylistCard'
import StreamingCard from '../components/StreamingCard'
import TrimEditor from '../components/TrimEditor'
import CapabilitiesPanel from '../components/CapabilitiesPanel'
import Choice from '../components/Choice'
import Thumbnail from '../components/Thumbnail'

type Status = 'idle' | 'detecting' | 'error'

const STAGE_LABEL: Record<DetectStage, TranslationKey> = {
  idle: 'detect.resolving',
  resolving: 'detect.resolving',
  engine: 'detect.engine',
  scraping: 'detect.scraping',
  browsing: 'detect.browsing',
  probing: 'detect.probing',
  done: 'detect.probing'
}

/**
 * One field, centred, and nothing competing with it.
 *
 * The old home screen led with a gradient headline, a subtitle, a chip cloud of
 * site names and six capability cards — four blocks of chrome the user has to
 * read past before reaching the only control that matters. Here the input is
 * the first thing on screen and everything else is either a consequence of it
 * or filed underneath a rule.
 */
export default function HomeView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const requestSearch = useStore((s) => s.requestSearch)
  const pendingUrl = useStore((s) => s.pendingUrl)
  const takePendingUrl = useStore((s) => s.takePendingUrl)
  const saveSettings = useStore((s) => s.saveSettings)
  const detectStatus = useStore((s) => s.detect)

  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<AppErrorCode | undefined>()
  const [cookieHint, setCookieHint] = useState(false)
  const [selection, setSelection] = useState<Selection>({ mode: 'video', quality: 'best' })
  const [starting, setStarting] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [trimOpen, setTrimOpen] = useState(false)
  const [section, setSection] = useState<TrimRange>({ start: 0 })
  /** Re-encode for an exact cut, or copy the stream and land on a keyframe. */
  const [precise, setPrecise] = useState(true)
  /*
    Where this download lands. `DownloadRequest.outputDir` was always honoured
    by the main process but nothing ever set it, so every file in every project
    went to the one folder in Settings. Deliberately sticky across downloads:
    the reason to change it is usually "everything for this job goes here".
  */
  const [saveDir, setSaveDir] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<string | null>(null)

  /*
    Bring a fresh result to the top of the view.
    A detected video's card runs to ~470px — taller than what's left below the
    input on a short window — so without this the download button lands under
    the fold and the screen looks like nothing happened.

    An effect rather than `requestAnimationFrame`, and an instant scroll rather
    than a smooth one: both rAF and smooth scrolling are driven by the frame
    clock, which does not tick in a throttled window — and a detect can very
    well finish while the app is in the background. Measured with the clock
    stalled: the smooth call moved nothing, the instant one lifted the download
    button from 802px to 525px in a 600px window. Whether the primary action is
    reachable is not something to leave to the compositor.
  */
  useEffect(() => {
    if (!info) return
    const result = resultRef.current
    const host = scrollRef.current
    if (!result || !host) return
    /*
      Scroll by the smallest amount that brings the whole card — and with it the
      download button — into view.

      `scrollIntoView({ block: 'start' })` always pinned the card to the very
      top, which on a window just tall enough to hold it sliced the URL field in
      half against the chrome: a control cut through the middle reads as a
      rendering fault, not as a scroll position. Aligning to the card's *bottom*
      instead, clamped so we never scroll past its top, keeps everything above
      it whole whenever there is room and degrades to the old behaviour only
      when the card genuinely doesn't fit.
    */
    const top = result.offsetTop
    const bottom = top + result.offsetHeight
    host.scrollTop = Math.max(0, Math.min(top, bottom - host.clientHeight))
  }, [info])

  useEffect(() => {
    // `preventScroll` matters: focusing an element inside a scroll container
    // makes the browser reveal it, and measured on a real render that scrolled
    // this view down by 207px — putting the heading, the subtitle and the
    // field's own label above the fold on the very first frame.
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const detect = async (value?: string): Promise<void> => {
    const target = (value ?? url).trim()
    if (!target) return
    // Plain text (not a link) → search video services by title.
    if (!isProbablyUrl(target)) {
      requestSearch(target)
      return
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    requestRef.current = requestId
    setStatus('detecting')
    setError('')
    setErrorCode(undefined)
    setCookieHint(false)
    setInfo(null)
    // Same reasoning as SearchView: the engine can refuse to install, and a
    // rejected invoke would otherwise leave the card in its skeleton.
    const res: DetectResult = await window.api.detect(target, requestId).catch(
      (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )
    if (requestRef.current !== requestId) return
    requestRef.current = null
    if (res.ok && res.info) {
      setInfo(res.info)
      // Preselect the user's defaults, falling back to automatic "best" when
      // their default quality isn't available for this particular video.
      const mode = initialMode(settings)
      const quality = initialQuality(settings, availableHeights(res.info.formats))
      setSelection({
        mode,
        quality,
        targetHeight: resolveSelection(res.info.formats, { mode, quality })?.height
      })
      setTrimOpen(false)
      setSection({ start: 0 })
      setPrecise(true)
      setStatus('idle')
    } else {
      setError(res.error || t('home.errorTitle'))
      setErrorCode(res.errorCode)
      setCookieHint(Boolean(res.cookieHint) || needsCookiesOften(target))
      setStatus('error')
    }
  }

  const cancelDetect = (): void => {
    if (requestRef.current) void window.api.cancelDetect(requestRef.current)
    requestRef.current = null
    setStatus('idle')
  }

  const reset = (): void => {
    setInfo(null)
    setError('')
    setErrorCode(undefined)
    setCookieHint(false)
    setStatus('idle')
    setUrl('')
  }

  // Paste a link anywhere to auto-detect; Esc clears; drop a link onto the window.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const text = e.clipboardData?.getData('text')?.trim()
      if (text && isProbablyUrl(text)) {
        setUrl(text)
        void detect(text)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') reset()
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text')?.trim()
      if (text && isProbablyUrl(text)) {
        setUrl(text)
        void detect(text)
      }
    }
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', prevent)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', prevent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
    A link handed to this screen from elsewhere — the clipboard strip, a link
    the OS opened the app with, a second instance. It arrives as state rather
    than an event precisely because the event was dispatched before this
    component existed to hear it.
  */
  useEffect(() => {
    if (!pendingUrl) return
    const link = takePendingUrl()
    if (!link) return
    setUrl(link)
    void detect(link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl])

  const chooseSaveDir = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) setSaveDir(dir)
  }

  const paste = async (): Promise<void> => {
    const text = await window.api.readClipboard().catch(() => '')
    if (!text) return
    setUrl(text)
    if (isProbablyUrl(text)) void detect(text)
  }

  const start = async (): Promise<void> => {
    if (!info) return
    setStarting(true)
    let ok = false
    try {
      ok = await queueDownload({
        url: info.downloadUrl || info.webpageUrl || url,
        title: info.title,
        thumbnail: info.thumbnail,
        mode: selection.mode,
        quality: selection.quality,
        formatId: selection.formatId,
        // Both travel with the request so the queue can be honest about a job
        // it hasn't started yet: what resolution `best` came out as, and how
        // long the source is — which is what turns a trimmed download's
        // progress into a percentage rather than a spinner.
        targetHeight: selection.targetHeight,
        duration: info.duration,
        // Names the per-site subfolder; without it every natively-supported
        // site shares one called "other".
        extractor: info.extractor,
        outputDir: saveDir || undefined,
        /*
          Only when a video is what's being fetched. The trim editor is hidden
          in audio mode but its state was kept, so switching to "audio only"
          after setting a cut silently produced a 90-second clip of the track —
          and relabelled the primary button "trim" with no trim UI on screen.
        */
        section: cutting ? section : undefined,
        preciseSection: precise
      })
    } finally {
      setStarting(false)
    }
    if (!ok) return
    reset()
    setView('downloads')
  }

  const batchLinks = useMemo(
    () =>
      batchText
        .split(/[\n\s]+/)
        .map((line) => line.trim())
        .filter((line) => isProbablyUrl(line)),
    [batchText]
  )

  const queueBatch = async (): Promise<void> => {
    if (!batchLinks.length) return
    setStarting(true)
    const mode = initialMode(settings)
    let ok = false
    try {
      ok = await queueDownloads(
        batchLinks.map((link) => ({
          url: link,
          title: link,
          mode,
          quality: mode === 'audio' ? 'audio' : initialQuality(settings),
          outputDir: saveDir || undefined
        }))
      )
    } finally {
      setStarting(false)
    }
    if (!ok) return
    setBatchText('')
    setBatchOpen(false)
    setView('downloads')
  }

  /** A cut is only real while a video is what we're fetching. */
  const cutting = selection.mode === 'video' && trimOpen && hasTrim(section)
  const isSearchQuery = url.trim().length > 0 && !isProbablyUrl(url)
  const busy = status === 'detecting'

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <div className="mx-auto flex w-full max-w-[680px] flex-col px-6 pb-16 pt-14">
      {/* The focal control. Everything on this screen is downstream of it. */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter}>
        {/*
          A real heading, then a sentence saying what the app does. The first
          cut of this screen opened with the prompt set as an 11px uppercase
          micro-label — visually quiet, and completely silent about what the
          window in front of you is for.
        */}
        <h1 className="h1">{t('home.title')}</h1>
        <p className="lead mt-2">{t('home.subtitle')}</p>

        <label className="label mb-2 mt-7 block" htmlFor="uvd-url">
          {t('home.linkLabel')}
        </label>
        <div className="field flex items-center gap-1.5 rounded-3 p-2">
          <input
            id="uvd-url"
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && detect()}
            placeholder={t('home.placeholder')}
            className="no-drag min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[16px] text-ink outline-none placeholder:text-ink-3"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="btn-icon-bare"
            onClick={paste}
            title={t('common.paste')}
            aria-label={t('common.paste')}
          >
            <ClipboardPaste size={17} />
          </button>
          <button
            className="btn-solid px-5"
            data-uvd="detect"
            onClick={() => detect()}
            disabled={!url.trim() || busy}
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isSearchQuery ? (
              <Search size={16} />
            ) : (
              <ArrowRight size={16} />
            )}
            {isSearchQuery ? t('common.search') : t('home.get')}
          </button>
        </div>

        {/* Secondary entry points. Buttons, not bare text: they do things, and
            an underlined-looking phrase is a weaker promise than a control. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-quiet" onClick={() => setBatchOpen((v) => !v)}>
            <Layers size={15} /> {t('home.batchOpen')}
          </button>
          <button className="btn-quiet" onClick={() => window.api.openBrowser()}>
            <Globe size={15} /> {t('browser.open')}
          </button>
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {batchOpen && (
          <motion.div {...collapse} className="overflow-hidden">
            <div className="well mt-4 p-4">
              <p className="label mb-1.5">{t('home.batch')}</p>
              <p className="hint mb-3">{t('home.batchHint')}</p>
              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                rows={5}
                spellCheck={false}
                className="field mono resize-none bg-canvas text-[13px]"
                placeholder={'https://…\nhttps://…'}
              />
              <button
                className="btn-solid mt-3 w-full py-3"
                disabled={!batchLinks.length || starting}
                onClick={queueBatch}
              >
                {starting ? <Loader2 size={15} className="animate-spin" /> : null}
                {t('home.batchAdd', { count: batchLinks.length })}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6" ref={resultRef}>
        {/*
          No AnimatePresence here, and no exit animations.

          These four states are mutually exclusive, so an exit animation buys a
          fade nobody asked for and costs correctness: an exiting child stays
          mounted until it reports the animation finished, and in a window whose
          animation loop is throttled — a backgrounded downloader, which is the
          normal case — it never does. Measured in a real render: the capability
          list, the loading skeleton and the result card were all in flow at
          once, stacked, pushing the download button off the bottom of the
          window. States now swap instantly and only animate in.
        */}
        <>
          {status === 'detecting' && (
            <DetectingCard
              key="skeleton"
              stage={detectStatus?.stage ?? 'resolving'}
              label={t(STAGE_LABEL[detectStatus?.stage ?? 'resolving'])}
              slowHint={t('detect.slowHint')}
              cancelLabel={t('common.cancel')}
              onCancel={cancelDetect}
            />
          )}

          {status === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
              className="panel overflow-hidden"
            >
              <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
                <p className="h2">{t('home.errorTitle')}</p>
              </div>
              <div className="p-4">
                <p className="selectable break-words text-[13px] leading-relaxed text-ink">
                  {errorText(t, { error, errorCode, cookieHint })}
                </p>
                {/*
                  The engine's own words, kept but demoted. The sentence above
                  is what the user can act on; this is what they paste into a
                  bug report — and when the two are the same, printing it twice
                  is just noise.
                */}
                {error && errorCode && (
                  <p className="mono selectable mt-2 break-words text-[12px] leading-relaxed text-ink-3">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {/* The honest escape hatch: let the user find it by hand. */}
                  <button
                    className="btn-solid"
                    onClick={() => window.api.openBrowser(url || undefined)}
                  >
                    <Globe size={14} /> {t('browser.open')}
                  </button>
                  {cookieHint && (
                    <button className="btn-quiet" onClick={() => setView('settings')}>
                      {t('home.openAccessSettings')}
                    </button>
                  )}
                  <button className="btn-quiet" onClick={() => void detect()}>
                    <RotateCw size={14} /> {t('common.retry')}
                  </button>
                </div>
                <p className="hint mt-3">{t('browser.openHint')}</p>
              </div>
            </motion.div>
          )}

          {info && info.streaming && status === 'idle' && (
            <motion.div
              key="streaming"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
            >
              <StreamingCard info={info} onDone={() => setInfo(null)} />
            </motion.div>
          )}

          {info && info.isPlaylist && !info.streaming && status === 'idle' && (
            <motion.div
              key="playlist"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
            >
              <PlaylistCard info={info} onDone={() => setInfo(null)} />
            </motion.div>
          )}

          {info && !info.isPlaylist && !info.streaming && status === 'idle' && settings && (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
              className="panel overflow-hidden"
            >
              {/* What was found */}
              <div className="flex gap-4 border-b border-edge p-4">
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-2 bg-sink">
                  <Thumbnail
                    src={info.thumbnail}
                    pageUrl={info.webpageUrl}
                    className="h-full w-full object-cover"
                    loading="eager"
                    fallback={<div className="h-full w-full bg-sink" />}
                  />
                  {info.isLive && (
                    <span className="mono absolute left-1.5 top-1.5 rounded-1 bg-bad px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      live
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="h2 line-clamp-2" title={info.title}>
                    {info.title}
                  </h2>
                  <p className="mono mt-1.5 truncate text-[12px] text-ink-2">
                    {[
                      info.uploader,
                      info.viewCount != null ? formatCount(info.viewCount) : null,
                      info.duration != null ? formatDuration(info.duration) : null
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1">
                    <span className="tag">{info.extractor}</span>
                    {maxHeightOf(info.formats) > 0 && (
                      <span className="tag">{t('format.upTo', { height: maxHeightOf(info.formats) })}</span>
                    )}
                    {info.subtitleLanguages && info.subtitleLanguages.length > 0 && (
                      <span className="tag">
                        {t('format.subtitles', { count: info.subtitleLanguages.length })}
                      </span>
                    )}
                    {info.viaUniversal && (
                      <span className="tag text-accent-ink" title={t('home.universalHint')}>
                        {t('home.universal')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Choose, then commit */}
              <div className="p-4">
                <FormatSelector
                  info={info}
                  settings={settings}
                  initialMode={selection.mode}
                  initialQuality={selection.quality ?? 'best'}
                  onChangeAudioFormat={(fmt) => saveSettings({ audioFormat: fmt })}
                  onSelectionChange={setSelection}
                />

                {/*
                  A live stream has no end, so it has no section to cut out of
                  it and no percentage to report — it records until it is
                  stopped. Offering a trim editor over a timeline that doesn't
                  exist yet was an invitation to a download that fails.
                */}
                {info.isLive && (
                  <p className="hint mt-4 border-t border-edge pt-4">{t('home.liveHint')}</p>
                )}

                {/* Trim before downloading: the engine fetches only this
                    section, so clipping a highlight out of a long stream costs
                    seconds instead of the whole file. */}
                {selection.mode === 'video' && !info.isLive && (
                  <div className="mt-5 border-t border-edge pt-4">
                    <button
                      onClick={() => setTrimOpen((v) => !v)}
                      className="flex w-full items-center justify-between rounded-1 py-1 text-[13px] font-medium text-ink-2 transition-colors duration-fast ease-ease hover:text-ink"
                    >
                      <span className="flex items-center gap-2">
                        <Scissors size={13} /> {t('trim.enable')}
                        {trimOpen && hasTrim(section) && (
                          <span className="mono text-[12px] text-accent-ink">
                            {toClock(section.start ?? 0)}
                            {section.end != null ? ` → ${toClock(section.end)}` : ' →'}
                          </span>
                        )}
                      </span>
                      <motion.span animate={{ rotate: trimOpen ? 180 : 0 }} transition={enter}>
                        <ChevronDown size={15} />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {trimOpen && (
                        <motion.div {...collapse} className="overflow-hidden">
                          <div className="space-y-4 pt-4">
                            <TrimEditor
                              duration={info.duration}
                              value={section}
                              onChange={setSection}
                              hint={t('trim.downloadHint')}
                            />
                            {/*
                              The same choice the trim editor for a finished file
                              offers. A trimmed download always re-encoded, which
                              is by far the slowest part of it — and for "just
                              take the middle ten minutes" the extra precision
                              buys nothing.
                            */}
                            <div>
                              <p className="label mb-2">{t('trim.precise')}</p>
                              <Choice
                                label={t('trim.precise')}
                                value={precise ? 'precise' : 'fast'}
                                onChange={(v) => setPrecise(v === 'precise')}
                                options={[
                                  { value: 'precise', label: t('trim.precise') },
                                  { value: 'fast', label: t('trim.fast') }
                                ]}
                              />
                              <p className="hint mt-2">
                                {precise ? t('trim.preciseHint') : t('trim.fastHint')}
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-edge pt-4">
                  <div className="min-w-0 flex-1">
                    <p className="label mb-1.5">{t('settings.saveLocation')}</p>
                    <p
                      className="mono truncate text-[12px] text-ink-2"
                      title={saveDir || settings.downloadDir}
                    >
                      {saveDir || settings.downloadDir}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {saveDir && (
                      <button className="btn-quiet" onClick={() => setSaveDir('')}>
                        {t('home.saveDefault')}
                      </button>
                    )}
                    <button className="btn-quiet" onClick={chooseSaveDir}>
                      <Folder size={14} /> {t('common.change')}
                    </button>
                  </div>
                </div>

                <button
                  className="btn-solid mt-4 w-full py-3.5 text-[14px]"
                  onClick={start}
                  disabled={starting}
                >
                  {starting ? <Loader2 size={16} className="animate-spin" /> : null}
                  {cutting ? t('trim.apply') : t('common.download')}
                </button>
              </div>
            </motion.div>
          )}

          {status === 'idle' && !info && (
            <motion.div
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={enter}
            >
              <CapabilitiesPanel />
            </motion.div>
          )}
        </>
        </div>
      </div>
    </div>
  )
}

/**
 * The waiting state. Blocks pulse in place rather than sweeping a gradient
 * across themselves — a shimmer repaints every frame to communicate nothing the
 * pulse doesn't, and detection can run for half a minute on an unknown site.
 */
function DetectingCard({
  stage,
  label,
  slowHint,
  cancelLabel,
  onCancel
}: {
  stage: DetectStage
  label: string
  slowHint: string
  cancelLabel: string
  onCancel: () => void
}): JSX.Element {
  const slow = stage === 'scraping' || stage === 'browsing'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={enter}
      className="panel overflow-hidden"
    >
      <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <span className="h-1.5 w-1.5 shrink-0 animate-idle-pulse rounded-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p className="h2 truncate">{label}</p>
          {slow && <p className="hint mt-1 truncate">{slowHint}</p>}
        </div>
        <button className="btn-quiet shrink-0 px-3 py-1.5" onClick={onCancel}>
          <X size={13} /> {cancelLabel}
        </button>
      </div>
      <div className="flex gap-4 p-4">
        <div className="skeleton aspect-video w-36 shrink-0 rounded-2" />
        <div className="flex-1 space-y-2 py-1">
          <div className="skeleton h-3.5 w-3/4 rounded-1" />
          <div className="skeleton h-3 w-1/2 rounded-1" />
          <div className="skeleton h-4 w-20 rounded-1" />
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <div className="skeleton h-9 w-full rounded-2" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-[72px] rounded-full" />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
