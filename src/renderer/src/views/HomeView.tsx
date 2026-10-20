import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { collapse, enter } from '../lib/motion'
import {
  ArrowRight,
  ChevronDown,
  ClipboardPaste,
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
  type DetectPreview,
  type DetectResult,
  type DetectStage,
  type MediaInfo,
  type TrimRange
} from '@shared/types'
import { engineKnowsHost, looksLikeCollection, needsCookiesOften, youtubeIdOf } from '@shared/urls'
import { detectCache, inflightDetects, useStore } from '../store'
import { describeError, errorText } from '../lib/errors'
import { formatBytes, formatCount, formatDuration, isProbablyUrl } from '../lib/format'
import {
  availableHeights,
  initialMode,
  initialQuality,
  maxHeightOf,
  outcomeSummary,
  resolveSelection
} from '../lib/quality'
import { detectIsDone, errorLead } from '../lib/emphasis'
import { queueDownload, queueDownloads } from '../lib/queue'
import { escapeClearsHome, isDownloadNowChord, linkIn } from '../lib/shortcuts'
import { toClock } from '../lib/time'
import { useT, useTp, type TranslationKey } from '../i18n'
import FormatSelector, { type Selection } from '../components/FormatSelector'
import PlaylistCard from '../components/PlaylistCard'
import SaveLocation from '../components/SaveLocation'
import StreamingCard from '../components/StreamingCard'
import TrimEditor from '../components/TrimEditor'
import CapabilitiesPanel from '../components/CapabilitiesPanel'
import HomeActivity from '../components/HomeActivity'
import Choice from '../components/Choice'
import Thumbnail from '../components/Thumbnail'
import ReportPrompt from '../components/ReportPrompt'

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
  const tp = useTp()
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const requestSearch = useStore((s) => s.requestSearch)
  const pendingUrl = useStore((s) => s.pendingUrl)
  const takePendingUrl = useStore((s) => s.takePendingUrl)
  const saveSettings = useStore((s) => s.saveSettings)
  const detectStatus = useStore((s) => s.detect)
  const detectPreview = useStore((s) => s.detectPreview)
  const hasHistory = useStore((s) => s.downloads.length > 0)
  const beginDetect = useStore((s) => s.beginDetect)
  const endDetect = useStore((s) => s.endDetect)

  const [url, setUrl] = useState('')
  /** The link the result or error on screen came from; see `detectIsDone`. */
  const [detectedUrl, setDetectedUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<AppErrorCode | undefined>()
  const [cookieHint, setCookieHint] = useState(false)
  /** The failed link main kept for an error report — the field may be edited since. */
  const [reported, setReported] = useState<{ id: string; url: string } | null>(null)
  const [selection, setSelection] = useState<Selection>({ mode: 'video', quality: 'best' })
  const [starting, setStarting] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [trimOpen, setTrimOpen] = useState(false)
  /*
    For aria-controls on the two disclosures below. Their panels mount only
    while open, so the attribute is set only then: pointing it at an id that
    does not exist is worse than leaving it off.
  */
  const batchPanelId = useId()
  const trimPanelId = useId()
  const [section, setSection] = useState<TrimRange>({ start: 0 })
  /** Re-encode for an exact cut, or copy the stream and land on a keyframe. */
  const [precise, setPrecise] = useState(true)
  /*
    Where the job on screen lands. `DownloadRequest.outputDir` was always
    honoured by the main process but nothing ever set it, so every file in
    every project went to the one folder in Settings.

    One value for every card here - a video, a playlist, a series, a batch -
    and each of them shows it above its button. It lives as long as this
    screen does: queueing moves to the Downloads view, which unmounts Home, so
    the next job starts from the Settings folder again. A folder picked for
    one job is never applied to another without being on screen.
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

  /** Stop listening for the detect in flight, and stop the engine working on it. */
  const dropRequest = (): void => {
    if (requestRef.current) void window.api.cancelDetect(requestRef.current)
    requestRef.current = null
    endDetect()
  }

  const detect = async (value?: string): Promise<void> => {
    const target = (value ?? url).trim()
    if (!target) return
    // Plain text (not a link) → search video services by title.
    if (!isProbablyUrl(target)) {
      requestSearch(target)
      return
    }
    // A new link supersedes one still detecting; the engine can stop on that.
    dropRequest()
    setError('')
    setErrorCode(undefined)
    setCookieHint(false)
    setReported(null)
    // The same link detected in the last few minutes: its card, at once.
    const cached = detectCache.get(target)
    if (cached) {
      show(target, cached)
      return
    }
    /*
      The clipboard strip may have started this one already; waiting on that
      run, under its request id, is both faster and one engine fewer. Its
      stage and preview events then reach this card too.
    */
    const adopted = inflightDetects.take(target)
    const requestId = adopted?.requestId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    requestRef.current = requestId
    beginDetect(target, requestId)
    setStatus('detecting')
    setInfo(null)
    // Same reasoning as SearchView: main reports an engine that won't install
    // as a coded result, but any other rejected invoke would otherwise leave
    // the card in its skeleton.
    let res: DetectResult = await (adopted?.promise ?? window.api.detect(target, requestId)).catch(
      (err: unknown) => ({ ok: false, error: describeError(err) })
    )
    if (requestRef.current !== requestId) return
    /*
      A prefetch is the engine probe alone, with no page scrape or browser
      behind it. When that was not enough, run the whole detect now that
      someone is actually waiting for it.
    */
    if (adopted && !res.ok && res.errorCode !== 'canceled') {
      res = await window.api.detect(target, requestId).catch(
        (err: unknown) => ({ ok: false, error: describeError(err) })
      )
      if (requestRef.current !== requestId) return
    }
    requestRef.current = null
    endDetect()
    detectCache.set(target, res)
    show(target, res)
  }

  /** Put a detect's outcome on screen, whether it just ran or came from the cache. */
  const show = (target: string, res: DetectResult): void => {
    setDetectedUrl(target)
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
      setReported(res.reportId ? { id: res.reportId, url: target } : null)
      setStatus('error')
    }
  }

  const cancelDetect = (): void => {
    dropRequest()
    setStatus('idle')
  }

  /*
    Clearing the screen used to leave the detect running underneath it: Esc a
    moment after pasting emptied the field, then the result card arrived under
    the empty field a second later, and yt-dlp worked on to the end regardless.
  */
  const reset = (): void => {
    dropRequest()
    setInfo(null)
    setError('')
    setErrorCode(undefined)
    setCookieHint(false)
    setReported(null)
    setStatus('idle')
    setUrl('')
  }

  /*
    Esc clears. Paste and drop live in usePasteDetect, which works on every
    screen and hands the link over through `pendingUrl` below — listening here
    as well would detect every pasted link twice.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (escapeClearsHome(e, useStore.getState().shortcutsOpen)) reset()
      // Not from the batch list: there Ctrl+Enter is a newline, or the batch's own business.
      else if (
        isDownloadNowChord(e) &&
        !useStore.getState().shortcutsOpen &&
        (e.target as HTMLElement | null)?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        void downloadNowRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving Home — ⌘/Ctrl+2…5 mid-detect — leaves no engine request behind.
  useEffect(() => () => dropRequest(), [])

  /*
    A link handed to this screen from elsewhere — a paste or a drop on any
    screen, the clipboard strip, a link the OS opened the app with, a second
    instance. It arrives as state rather than an event precisely because the
    event was dispatched before this component existed to hear it.

    When the store comes back empty, the link from this render still stands.
    StrictMode replays mount effects in development, cleanups first: the one
    above drops the detect this started, and a rerun that asked the store
    again would find it emptied — leaving the screen in its skeleton, waiting
    on a request nobody listens for.
  */
  useEffect(() => {
    if (!pendingUrl) return
    const link = takePendingUrl() ?? pendingUrl
    setUrl(link)
    void detect(link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl])

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

  /*
    Download without waiting for the format list.

    Detection is for choosing; most of the time the choice is the one in
    Settings, and the downloader resolves the link again on its own when the
    item starts. So while the card is still detecting - or straight from the
    field - the link can be queued with the default quality, under whatever
    title and poster are already known. A collection is the exception: queued
    whole it would fetch every video on a channel, so it waits for the picker.
    A result already on screen downloads what is selected on it, which starts
    out as those same defaults.
  */
  /*
    Only on hosts the engine reads by name. Anywhere else the link may need a
    site resolver's picker or the universal pass to become a stream at all,
    and queued as a bare page it would fail where waiting would have worked.
  */
  const canDownloadNow = (link: string): boolean =>
    Boolean(settings) && isProbablyUrl(link) && engineKnowsHost(link) && !looksLikeCollection(link)

  const downloadNow = async (): Promise<void> => {
    if (starting) return
    const target = url.trim()
    /*
      The card on screen only while the field still holds its link. Edited to
      another, the chord is about the new one: queuing the old result under
      it downloaded a video the field no longer named.
    */
    if (info && target === detectedUrl) {
      if (!info.isPlaylist && !info.streaming && status === 'idle') await start()
      return
    }
    if (!settings) return
    // A link that has to be detected first is detected, rather than nothing happening.
    if (!canDownloadNow(target)) {
      if (target && target !== detectedUrl) void detect(target)
      return
    }
    // The preview belongs to whichever link is detecting, which may not be this one.
    const preview = useStore.getState().detect?.url === target ? useStore.getState().detectPreview : null
    const ytId = youtubeIdOf(target)
    const mode = initialMode(settings)
    setStarting(true)
    let ok = false
    try {
      ok = await queueDownload({
        url: target,
        title: preview?.title || target,
        thumbnail: preview?.thumbnail ?? (ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : undefined),
        mode,
        quality: mode === 'audio' ? 'audio' : initialQuality(settings),
        outputDir: saveDir || undefined
      })
    } finally {
      setStarting(false)
    }
    if (!ok) return
    // Stops the detect too: the queue resolves the link for itself.
    reset()
    setView('downloads')
  }
  // The window listener is registered once; it calls whatever this render's is.
  const downloadNowRef = useRef(downloadNow)
  downloadNowRef.current = downloadNow

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

  /** What the download button restates: `1080p · MP4 · ~412 MB`. */
  const summary = info
    ? outcomeSummary(
        resolveSelection(info.formats, selection, settings?.audioFormat),
        (bytes) => formatBytes(bytes)
      )
    : []

  /** A cut is only real while a video is what we're fetching. */
  const cutting = selection.mode === 'video' && trimOpen && hasTrim(section)
  const isSearchQuery = url.trim().length > 0 && !isProbablyUrl(url)
  const busy = status === 'detecting'
  const detectDone = detectIsDone({
    url,
    detectedUrl,
    showing: Boolean(info) || status === 'error',
    batchOpen
  })
  const retryLeads = errorLead(errorCode) === 'retry'

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <div className="mx-auto flex w-full max-w-[680px] flex-col px-6 pb-16 pt-6 min-[880px]:max-w-[840px]">
      {/* The focal control. Everything on this screen is downstream of it. */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter}>
        {/*
          A real heading, then a sentence saying what the app does. The first
          cut of this screen opened with the prompt set as an 11px uppercase
          micro-label — visually quiet, and completely silent about what the
          window in front of you is for.
        */}
        <h1 className="h1 text-[20px]">{t('home.title')}</h1>
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
            // ⌘/Ctrl+Enter is "download now", answered by the window listener above.
            onKeyDown={(e) => e.key === 'Enter' && !e.metaKey && !e.ctrlKey && detect()}
            /*
              Fields take dropped text at the caret, and usePasteDetect leaves
              them to it — which here would splice a second link into the
              first. A link dropped on this field replaces it and is detected,
              as it is anywhere else in the window.
            */
            onDrop={(e) => {
              const link = linkIn(e.dataTransfer.getData('text'))
              if (!link) return
              e.preventDefault()
              setUrl(link)
              void detect(link)
            }}
            /*
              The field is focused the moment Home opens, and usePasteDetect
              leaves pastes into fields alone — so ⌘/Ctrl+V of a link, the
              most common way in, only ever filled the field and waited for
              Enter. A pasted link replaces the field and is detected; any
              other text pastes at the caret as it always did.
            */
            onPaste={(e) => {
              const link = linkIn(e.clipboardData.getData('text'))
              if (!link) return
              e.preventDefault()
              setUrl(link)
              void detect(link)
            }}
            placeholder={t('home.placeholder')}
            aria-label={t('home.placeholder')}
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
            className={detectDone ? 'btn-quiet px-5' : 'btn-solid px-5'}
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
          <button
            className="btn-quiet"
            onClick={() => setBatchOpen((v) => !v)}
            aria-expanded={batchOpen}
            aria-controls={batchOpen ? batchPanelId : undefined}
          >
            <Layers size={15} /> {t('home.batchOpen')}
          </button>
          <button className="btn-quiet" onClick={() => window.api.openBrowser()}>
            <Globe size={15} /> {t('browser.open')}
          </button>
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {batchOpen && (
          <motion.div {...collapse} id={batchPanelId} className="overflow-hidden">
            <div className="well mt-4 p-4">
              <p className="label mb-1.5">{t('home.batch')}</p>
              <p className="hint mb-3">{t('home.batchHint')}</p>
              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                rows={5}
                aria-label={t('home.batchHint')}
                spellCheck={false}
                className="field mono resize-none bg-canvas text-[13px]"
                placeholder={'https://…\nhttps://…'}
              />
              <SaveLocation
                value={saveDir}
                onChange={setSaveDir}
                defaultDir={settings?.downloadDir ?? ''}
                className="mt-4"
              />
              <button
                className="btn-solid mt-4 w-full py-3"
                disabled={!batchLinks.length || starting}
                onClick={queueBatch}
              >
                {starting ? <Loader2 size={15} className="animate-spin" /> : null}
                {tp('home.batchAdd', batchLinks.length)}
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
              url={detectStatus?.url ?? url}
              preview={detectPreview}
              onDownloadNow={canDownloadNow(url.trim()) ? () => void downloadNow() : undefined}
              starting={starting}
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
                  {/* The honest escape hatch: let the user find it by hand —
                      unless the link is fine and only the moment wasn't. */}
                  <button
                    className={retryLeads ? 'btn-quiet' : 'btn-solid'}
                    onClick={() => window.api.openBrowser(url || undefined)}
                  >
                    <Globe size={14} /> {t('browser.open')}
                  </button>
                  {cookieHint && (
                    <button className="btn-quiet" onClick={() => setView('settings')}>
                      {t('home.openAccessSettings')}
                    </button>
                  )}
                  <button
                    className={retryLeads ? 'btn-solid' : 'btn-quiet'}
                    onClick={() => void detect()}
                  >
                    <RotateCw size={14} /> {t('common.retry')}
                  </button>
                </div>
                <p className="hint mt-3">{t('browser.openHint')}</p>
                {/* Keyed by the failure, so a retry that fails again asks afresh. */}
                {reported && (
                  <ReportPrompt
                    key={reported.id}
                    reportId={reported.id}
                    stage="detect"
                    url={reported.url}
                    errorCode={errorCode}
                  />
                )}
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
              <StreamingCard
                info={info}
                onDone={() => setInfo(null)}
                saveDir={saveDir}
                onSaveDirChange={setSaveDir}
              />
            </motion.div>
          )}

          {info && info.isPlaylist && !info.streaming && status === 'idle' && (
            <motion.div
              key="playlist"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
            >
              <PlaylistCard
                info={info}
                onDone={() => setInfo(null)}
                saveDir={saveDir}
                onSaveDirChange={setSaveDir}
              />
            </motion.div>
          )}

          {info && !info.isPlaylist && !info.streaming && status === 'idle' && settings && (
            <motion.div
              key="info"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={enter}
              /*
                Two columns from 880px: what was found on the left, what to do
                with it on the right, so the choice and the thing chosen are
                side by side instead of the poster scrolling away above it.
                Narrower, one column, with the download bar pinned to the
                bottom of the view while the card is on screen.

                `overflow-clip`, not `overflow-hidden`: it clips the corners
                the same way but is not a scroll container, and a sticky bar
                inside a scroll container that never scrolls sticks to nothing.
              */
              className="panel overflow-clip min-[880px]:grid min-[880px]:grid-cols-[240px_minmax(0,1fr)]"
            >
              {/* What was found */}
              <div className="flex gap-4 border-b border-edge p-4 min-[880px]:flex-col min-[880px]:border-b-0 min-[880px]:border-r">
                <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-2 bg-sink min-[880px]:w-full">
                  <Thumbnail
                    src={info.thumbnail}
                    pageUrl={info.webpageUrl}
                    className="h-full w-full object-cover"
                    loading="eager"
                    fallback={<div className="h-full w-full bg-sink" />}
                  />
                  {/*
                    The one mark that changes what the download means — no trim,
                    no percentage — so it gets the label floor (11px) and a
                    label colour checked against the fill; white on Night's pink
                    was 2.69:1, at 9px, and in English whatever the language.
                    `font-mono`, not `.mono`: that class sits after the utilities
                    and its tight letter-spacing would win over the tracking.
                  */}
                  {info.isLive && (
                    <span className="absolute left-1.5 top-1.5 rounded-1 bg-bad px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-bad-fg">
                      {t('home.liveBadge')}
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
                        {tp('format.subtitles', info.subtitleLanguages.length)}
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
              <div className="flex min-w-0 flex-col">
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
                      aria-expanded={trimOpen}
                      aria-controls={trimOpen ? trimPanelId : undefined}
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
                        <motion.div {...collapse} id={trimPanelId} className="overflow-hidden">
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

                <SaveLocation
                  value={saveDir}
                  onChange={setSaveDir}
                  defaultDir={settings.downloadDir}
                  className="mt-5 border-t border-edge pt-4"
                />
              </div>

              {/*
                The button says what it will fetch. A cut keeps its own verb:
                its size is a part of the file's, and a full-file figure next
                to "trim" would be a number for something else.
              */}
              <div className="sticky bottom-0 mt-auto border-t border-edge bg-raise p-4">
                <button
                  className="btn-solid w-full py-3.5 text-[14px]"
                  onClick={start}
                  disabled={starting}
                >
                  {starting ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span className="truncate">
                    {cutting
                      ? t('trim.apply')
                      : summary.length
                        ? t('home.downloadSummary', { details: summary.join(' · ') })
                        : t('common.download')}
                  </span>
                </button>
              </div>
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
              {/* The introduction is for the first run; after that, what is happening. */}
              {hasHistory ? <HomeActivity /> : <CapabilitiesPanel />}
            </motion.div>
          )}
        </>
        </div>
      </div>
    </div>
  )
}

/** The host a link is on, for the card's site tag while the extractor is not known yet. */
function hostLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The waiting state, shaped like the result it is waiting for.
 *
 * Blocks pulse in place rather than sweeping a gradient across themselves — a
 * shimmer repaints every frame to communicate nothing the pulse doesn't, and
 * detection can run for half a minute on an unknown site.
 *
 * What is already known is drawn for real: a YouTube video's poster comes
 * straight from its id, and a title, uploader and poster from the site's
 * oEmbed answer replace their skeletons when it lands, usually well before
 * the engine is done. After a few seconds a counter says how long it has
 * been, so a slow site reads as working rather than stuck. The counter is a
 * one-second interval, not a frame loop: it has to keep counting in a window
 * the compositor has throttled.
 */
function DetectingCard({
  stage,
  label,
  url,
  preview,
  slowHint,
  cancelLabel,
  onCancel,
  onDownloadNow,
  starting
}: {
  stage: DetectStage
  label: string
  url: string
  preview: DetectPreview | null
  slowHint: string
  cancelLabel: string
  onCancel: () => void
  /** Absent for a link that has to be detected first - a playlist or channel. */
  onDownloadNow?: () => void
  starting: boolean
}): JSX.Element {
  const t = useT()
  const slow = stage === 'scraping' || stage === 'browsing'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [url])

  const ytId = youtubeIdOf(url)
  const poster = preview?.thumbnail ?? (ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : undefined)
  const host = hostLabel(url)
  const skeletonThumb = <div className="skeleton h-full w-full" />

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={enter}
      className="panel overflow-hidden"
      aria-busy="true"
    >
      <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <span className="h-1.5 w-1.5 shrink-0 animate-idle-pulse rounded-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p className="h2 truncate">{label}</p>
          {slow && <p className="hint mt-1 truncate">{slowHint}</p>}
        </div>
        {elapsed >= 3 && (
          <span className="mono shrink-0 text-[12px] tabular-nums text-ink-3" aria-hidden="true">
            {t('detect.elapsed', { seconds: elapsed })}
          </span>
        )}
        <button className="btn-quiet shrink-0 px-3 py-1.5" onClick={onCancel}>
          <X size={13} /> {cancelLabel}
        </button>
      </div>
      <div className="flex gap-4 p-4">
        <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-2 bg-sink">
          {poster ? (
            <Thumbnail
              src={poster}
              pageUrl={url}
              className="h-full w-full object-cover"
              loading="eager"
              fallback={skeletonThumb}
            />
          ) : (
            skeletonThumb
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2 py-1">
          {preview?.title ? (
            <p className="h2 line-clamp-2" title={preview.title}>
              {preview.title}
            </p>
          ) : (
            <>
              <div className="skeleton h-3.5 w-3/4 rounded-1" />
              <div className="skeleton h-3 w-1/2 rounded-1" />
            </>
          )}
          {preview?.author && <p className="mono truncate text-[12px] text-ink-2">{preview.author}</p>}
          {host && <span className="tag">{host}</span>}
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
      {onDownloadNow && (
        <div className="border-t border-edge p-4">
          <button
            className="btn-solid w-full py-3 text-[14px]"
            onClick={onDownloadNow}
            disabled={starting}
          >
            {starting ? <Loader2 size={16} className="animate-spin" /> : null}
            {t('home.downloadNow')}
          </button>
          <p className="hint mt-2 text-center">{t('home.downloadNowHint')}</p>
        </div>
      )}
    </motion.div>
  )
}
