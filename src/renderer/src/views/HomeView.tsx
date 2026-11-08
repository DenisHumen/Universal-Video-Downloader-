import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { enter } from '../lib/motion'
import { Download, Globe, Layers } from '../ui/icons'
import type { DetectStage, MediaInfo, SearchResult } from '@shared/types'
import { engineKnowsHost, looksLikeCollection, youtubeIdOf } from '@shared/urls'
import { useStore } from '../store'
import { isProbablyUrl } from '../lib/format'
import { availableHeights, initialMode, initialQuality, resolveSelection } from '../lib/quality'
import { detectIsDone } from '../lib/emphasis'
import { queueDownload } from '../lib/queue'
import { escapeClearsHome, isDownloadNowChord } from '../lib/shortcuts'
import { isMultiLink } from '../lib/batch'
import { useT, type TranslationKey } from '../i18n'
import HeaderSlot from '../shell/HeaderSlot'
import { Icon } from '../ui'
import Tooltip from '../ui/Tooltip'
import CapabilitiesPanel from '../components/CapabilitiesPanel'
import HomeActivity from '../components/HomeActivity'
import UrlBar from './home/UrlBar'
import DetectingCard from './home/DetectingCard'
import ResultPanel from './home/ResultPanel'
import BatchPanel from './home/BatchPanel'
import InlineSearch from './home/InlineSearch'
import { isCutting, type ResultChoice } from './home/VideoResult'
import { useDetect, useInlineSearch } from './home/hooks'

const STAGE_LABEL: Record<DetectStage, TranslationKey> = {
  idle: 'detect.resolving',
  resolving: 'detect.resolving',
  engine: 'detect.engine',
  scraping: 'detect.scraping',
  browsing: 'detect.browsing',
  probing: 'detect.probing',
  done: 'detect.probing'
}

const FRESH_CHOICE: ResultChoice = { selection: { mode: 'video', quality: 'best' }, trimOn: false, section: { start: 0 }, precise: true }

/**
 * Download (5.4): one entry that takes everything — a link becomes the
 * detected card, several lines the inline batch, a title the top results
 * inline — over either a StatusPage (first run) or what is happening.
 *
 * The pieces live in views/home: UrlBar (the entry), DetectingCard (the
 * wait, shaped like the result), ResultPanel (error, series, playlist or a
 * video's card), BatchPanel, InlineSearch, and the hooks that run detects
 * and searches.
 */
export default function HomeView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const requestSearch = useStore((s) => s.requestSearch)
  const pendingUrl = useStore((s) => s.pendingUrl)
  const takePendingUrl = useStore((s) => s.takePendingUrl)
  const detectStatus = useStore((s) => s.detect)
  const detectPreview = useStore((s) => s.detectPreview)
  const hasHistory = useStore((s) => s.downloads.length > 0)

  const [url, setUrl] = useState('')
  const [choice, setChoice] = useState<ResultChoice>(FRESH_CHOICE)
  const [starting, setStarting] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  /*
    Where the job on screen lands: one value for every card here - a video,
    a playlist, a series, a batch - shown above each button. It lives as long
    as this screen does, so a folder picked for one job is never applied to
    another without being on screen.
  */
  const [saveDir, setSaveDir] = useState('')
  const batchPanelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const det = useDetect(t('home.errorTitle'))
  const { status, info } = det
  const search = useInlineSearch(url, !batchOpen && status !== 'detecting' && !info)

  /*
    Bring a fresh result into view by the smallest scroll that shows the whole
    card - and with it the download button. An effect and an instant scroll,
    not rAF or smooth scrolling: both ride the frame clock, which does not tick
    in a throttled background window, and a detect often finishes there.
  */
  useEffect(() => {
    if (!info) return
    const result = resultRef.current
    const host = scrollRef.current
    if (!result || !host) return
    const top = result.offsetTop
    const bottom = top + result.offsetHeight
    host.scrollTop = Math.max(0, Math.min(top, bottom - host.clientHeight))
  }, [info])

  // `preventScroll`: focusing inside a scroll container otherwise scrolls it.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  /** Preselect the user's defaults, clamped to what this video offers. */
  const preselect = (found: MediaInfo): void => {
    const mode = initialMode(settings)
    const quality = initialQuality(settings, availableHeights(found.formats))
    setChoice({
      ...FRESH_CHOICE,
      selection: { mode, quality, targetHeight: resolveSelection(found.formats, { mode, quality })?.height }
    })
  }

  /** Enter or the button: a link is detected, several open the batch, a title is searched. */
  const submit = (value?: string): void => {
    const target = (value ?? url).trim()
    if (!target) return
    if (isMultiLink(target)) {
      openBatch(target)
      return
    }
    if (!isProbablyUrl(target)) {
      search.runNow()
      return
    }
    void det.detect(target, preselect)
  }

  const openBatch = (text: string): void => {
    setBatchText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text))
    setBatchOpen(true)
    setUrl('')
  }

  const reset = (): void => {
    det.clear()
    setUrl('')
  }

  /*
    Esc clears; ⌘/Ctrl+Enter downloads now. Paste and drop live in
    usePasteDetect, which hands a link over through `pendingUrl` below.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (escapeClearsHome(e, useStore.getState().shortcutsOpen)) resetRef.current()
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
  }, [])

  /*
    A link handed over from elsewhere (a paste or drop on any screen, the
    clipboard strip, the OS, a second instance). When the store comes back
    empty, the link from this render still stands: StrictMode replays mount
    effects, and a rerun that asked the store again would find it emptied.
  */
  useEffect(() => {
    if (!pendingUrl) return
    const link = takePendingUrl() ?? pendingUrl
    setUrl(link)
    void det.detect(link, preselect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl])

  const paste = async (): Promise<void> => {
    const text = await window.api.readClipboard().catch(() => '')
    if (!text) return
    if (isMultiLink(text)) return openBatch(text)
    setUrl(text)
    if (isProbablyUrl(text)) void det.detect(text.trim(), preselect)
  }

  const start = async (): Promise<void> => {
    if (!info) return
    const cutting = isCutting(choice)
    const { selection } = choice
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
        // What `best` came out as, and the length that turns a cut's progress into a percentage.
        targetHeight: selection.targetHeight,
        duration: info.duration,
        // Names the per-site subfolder.
        extractor: info.extractor,
        outputDir: saveDir || undefined,
        // Only when a video is fetched: a cut left set in audio mode is not applied.
        section: cutting ? choice.section : undefined,
        preciseSection: choice.precise,
        subtitles: selection.mode === 'video' ? choice.subtitles : undefined,
        audioLanguage: choice.audioLanguage
      })
    } finally {
      setStarting(false)
    }
    if (ok) reset()
  }

  /*
    Download without waiting for the format list: while the card is still
    detecting - or straight from the field - a link on a host the engine
    reads by name is queued with the default quality, under whatever title
    and poster are known. A collection waits for the picker; a result already
    on screen downloads what is selected on it.
  */
  const canDownloadNow = (link: string): boolean =>
    Boolean(settings) && isProbablyUrl(link) && engineKnowsHost(link) && !looksLikeCollection(link)

  const downloadNow = async (): Promise<void> => {
    if (starting) return
    const target = url.trim()
    // The card on screen only while the field still holds its link.
    if (info && target === det.detectedUrl) {
      if (!info.isPlaylist && !info.streaming && status === 'idle') await start()
      return
    }
    if (!settings) return
    if (!canDownloadNow(target)) {
      if (target && target !== det.detectedUrl && isProbablyUrl(target)) void det.detect(target, preselect)
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
    // Stops the detect too: the queue resolves the link for itself.
    if (ok) reset()
  }
  // The window listener is registered once; it calls whatever this render's is.
  const downloadNowRef = useRef(downloadNow)
  downloadNowRef.current = downloadNow
  const resetRef = useRef(reset)
  resetRef.current = reset

  /** The "Audio Only" fix for a link with no video formats: queue it as audio, no format list needed. */
  const downloadAudioOnly = async (): Promise<void> => {
    const target = det.detectedUrl || url.trim()
    if (!target) return
    const ok = await queueDownload({ url: target, title: target, mode: 'audio', quality: 'audio', outputDir: saveDir || undefined })
    if (ok) reset()
  }

  const pick = (r: SearchResult): void => {
    const link = r.pickerUrl || r.url
    setUrl(r.url)
    void det.detect(link, preselect)
  }

  const isSearchQuery = url.trim().length > 0 && !isProbablyUrl(url.trim())
  const busy = status === 'detecting'
  const done = detectIsDone({ url, detectedUrl: det.detectedUrl, showing: Boolean(info) || status === 'error', batchOpen })
  const idle = status === 'idle' && !info && search.status === 'idle' && !batchOpen

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <div className="mx-auto flex w-full max-w-[680px] flex-col px-6 pb-16 pt-6">
        <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter}>
          {/*
            First run, or nothing downloaded yet: an AdwStatusPage (128 px
            symbolic, title-1, one line saying what to do) with the entry under
            it. After that the entry stands alone over what is happening.
          */}
          {!hasHistory && idle ? (
            <div className="flex flex-col items-center pb-2 pt-6 text-center">
              <Icon icon={Download} size="xl" className="text-ink opacity-50" />
              <h2 className="mt-6 text-title-1 text-ink">{t('home.statusTitle')}</h2>
              <p className="mt-3 max-w-[52ch] text-body text-ink">{t('home.subtitle')}</p>
            </div>
          ) : (
            <h2 className="sr-only">{t('home.statusTitle')}</h2>
          )}

          <UrlBar
            ref={inputRef}
            value={url}
            onChange={setUrl}
            onSubmit={() => submit()}
            onLink={(link) => {
              if (isMultiLink(link)) return openBatch(link)
              setUrl(link)
              void det.detect(link, preselect)
            }}
            onPaste={() => void paste()}
            busy={busy}
            searching={isSearchQuery}
            done={done}
          />

          {/* A flat header button that switches the entry into batch mode (A1.1 §3). */}
          <HeaderSlot>
            <Tooltip label={t('home.batchOpen')}>
              <button
                className="btn-icon-bare w-auto gap-2 px-2.5 text-control font-bold"
                onClick={() => setBatchOpen((v) => !v)}
                aria-label={t('home.batchOpen')}
                aria-pressed={batchOpen}
                aria-expanded={batchOpen}
                aria-controls={batchOpen ? batchPanelId : undefined}
              >
                <Layers size={16} /> <span className="hidden lg:inline">{t('home.batchHeader')}</span>
              </button>
            </Tooltip>
          </HeaderSlot>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-quiet" onClick={() => window.api.openBrowser()}>
              <Globe size={15} /> {t('browser.open')}
            </button>
          </div>
        </m.div>

        <AnimatePresence initial={false}>
          {batchOpen && (
            <BatchPanel
              id={batchPanelId}
              text={batchText}
              onText={setBatchText}
              settings={settings}
              saveDir={saveDir}
              onSaveDir={setSaveDir}
              onQueued={() => {
                setBatchText('')
                setBatchOpen(false)
              }}
            />
          )}
        </AnimatePresence>

        <div className="mt-6" ref={resultRef}>
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
              onCancel={det.cancel}
            />
          )}

          <ResultPanel
            status={status}
            info={info}
            failure={det.failure}
            settings={settings}
            url={url}
            choice={choice}
            onChoice={setChoice}
            saveDir={saveDir}
            onSaveDir={setSaveDir}
            onDownload={() => void start()}
            onRetry={() => submit()}
            onAudioOnly={() => void downloadAudioOnly()}
            onDone={det.dropInfo}
            starting={starting}
          />

          {!batchOpen && status === 'idle' && !info && (
            <InlineSearch search={search} onPick={pick} onSeeAll={(q) => requestSearch(q)} />
          )}

          {idle && (
            <m.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={enter}>
              {/* The introduction is for the first run; after that, what is happening. */}
              {hasHistory ? <HomeActivity /> : <CapabilitiesPanel />}
            </m.div>
          )}
        </div>
      </div>
    </div>
  )
}
