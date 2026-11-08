import { useMemo } from 'react'
import { m } from 'framer-motion'
import { enter } from '../../lib/motion'
import { CheckCircle2, Folder, FolderOpen, Loader2, Play } from '../../ui/icons'
import { hasTrim, type AppSettings, type DownloadMode, type MediaInfo, type QualityPreset, type TrimRange } from '@shared/types'
import { formatBytes, formatCount, formatDuration } from '../../lib/format'
import {
  availableHeights,
  heightLabel,
  maxHeightOf,
  outcomeResolution,
  outcomeSummary,
  QUALITY_HEIGHTS,
  resolveSelection
} from '../../lib/quality'
import { toClock } from '../../lib/time'
import { useLibraryHits } from '../../lib/libraryHits'
import { toast } from '../../lib/toast'
import { audioLanguages, languageName } from '../../lib/languages'
import { resolveLanguage, useI18n, useT, useTp } from '../../i18n'
import { useStore } from '../../store'
import { ActionRow, ComboRow, ExpanderRow, PreferencesGroup, SegmentedControl, cx } from '../../ui'
import Thumbnail from '../../components/Thumbnail'
import TrimEditor from '../../components/TrimEditor'
import SubtitlesRow from './SubtitlesRow'

export interface Selection {
  mode: DownloadMode
  quality?: QualityPreset
  formatId?: string
  /**
   * The height this selection resolves to, carried to the queue so a row
   * that says `best` can also say what "best" turned out to be.
   */
  targetHeight?: number
}

/** What the card is set to: the format choice, the cut, the folder. */
export interface ResultChoice {
  selection: Selection
  /** The cut's switch: a cut is only real while it is on and a video is fetched. */
  trimOn: boolean
  section: TrimRange
  /** Re-encode for an exact cut, or copy the stream and land on a keyframe. */
  precise: boolean
  /** Languages picked on the card; absent leaves it to Settings. */
  subtitles?: string[]
  /** The audio track picked on the card; absent is the site's default. */
  audioLanguage?: string
}

export const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac']
/** Never advertise more presets than a video plausibly has. */
const MAX_PRESETS = 6

/** A cut is only real while a video is what we're fetching. */
export const isCutting = (c: ResultChoice): boolean => c.selection.mode === 'video' && c.trimOn && hasTrim(c.section)

interface Props {
  info: MediaInfo
  /** The link that was detected: a download keeps whichever of it, the page or the stream, it was started from. */
  detectedUrl?: string
  settings: AppSettings
  choice: ResultChoice
  onChoice: (next: ResultChoice) => void
  onAudioFormat: (fmt: string) => void
  saveDir: string
  onSaveDir: (dir: string) => void
  onDownload: () => void
  starting: boolean
}

/**
 * A detected video, as A1 draws it (5.4): a poster card, then one boxed list
 * of choices — ComboRows for format and quality, ExpanderRows for the exact
 * stream and the cut, an ActionRow for where it is saved — and a pill button
 * that states the outcome: "Download · 1080p · MP4".
 */
export default function VideoResult({
  info,
  detectedUrl,
  settings,
  choice,
  onChoice,
  onAudioFormat,
  saveDir,
  onSaveDir,
  onDownload,
  starting
}: Props): JSX.Element {
  const t = useT()
  const tp = useTp()
  const language = useI18n((s) => s.language)
  const links = [info.downloadUrl, info.webpageUrl, detectedUrl].filter((l): l is string => Boolean(l))
  const hits = useLibraryHits(links)
  const held = links.map((l) => hits.get(l)).find(Boolean)
  const locale = useStore((s) => resolveLanguage(s.settings?.language ?? 'auto', s.appInfo?.locale ?? 'en'))
  const { selection } = choice
  const mode = selection.mode
  const languages = useMemo(() => audioLanguages(info.formats), [info.formats])
  const originalLanguage = languages.find((l) => l.original)
  const videoFormats = info.formats.filter((f) => f.kind !== 'audio')

  /**
   * Presets come from the heights this video really has; "Best" says which
   * one it is. A site that reports no heights (HLS, universal detection)
   * gets the standard ladder, so the download can still be capped.
   */
  const presets = useMemo(() => {
    const heights = availableHeights(info.formats)
    if (!heights.length) {
      return [
        { value: 'best', label: t('common.best') },
        ...QUALITY_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) }))
      ]
    }
    return [
      { value: 'best', label: `${t('common.best')} · ${heightLabel(heights[0])}` },
      ...heights.slice(0, MAX_PRESETS).map((h) => ({ value: String(h), label: heightLabel(h) }))
    ]
  }, [info.formats, t])

  const outcome = resolveSelection(info.formats, selection, settings.audioFormat)
  const facts = [
    outcomeResolution(outcome),
    outcome?.dynamicRange,
    outcome?.ext?.toUpperCase(),
    outcome?.bytes ? `≈ ${formatBytes(outcome.bytes)}` : null
  ].filter(Boolean)
  const youGet = facts.length ? `${t('format.youGet')} ${facts.join(' · ')}` : undefined

  const select = (next: Partial<Selection>): void => {
    const m: DownloadMode = next.mode ?? mode
    const quality: QualityPreset = m === 'audio' ? 'audio' : (next.quality ?? (selection.quality === 'audio' ? 'best' : selection.quality) ?? 'best')
    const formatId = m === 'audio' ? undefined : 'formatId' in next ? next.formatId : selection.formatId
    onChoice({
      ...choice,
      selection: {
        mode: m,
        quality,
        formatId,
        targetHeight: resolveSelection(info.formats, { mode: m, quality, formatId })?.height
      }
    })
  }

  const chosenFormat = selection.formatId ? videoFormats.find((f) => f.id === selection.formatId) : undefined
  const qualityOptions = chosenFormat
    ? [...presets, { value: `fmt:${chosenFormat.id}`, label: `${chosenFormat.resolution} · ${chosenFormat.ext.toUpperCase()}` }]
    : presets
  const qualityValue = chosenFormat ? `fmt:${chosenFormat.id}` : (selection.quality ?? 'best')

  const cutting = isCutting(choice)
  // A cut is a new file whatever is kept already, so it keeps its own button.
  const again = Boolean(held) && !cutting
  const summary = outcomeSummary(resolveSelection(info.formats, selection, settings.audioFormat), (b) => formatBytes(b))
  const meta = [
    info.uploader,
    info.viewCount != null ? formatCount(info.viewCount) : null,
    info.duration != null ? formatDuration(info.duration) : null
  ]
    .filter(Boolean)
    .join(' · ')

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) onSaveDir(dir)
  }

  return (
    <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter} className="space-y-6">
      {/* The poster card: what was found. */}
      <div className="panel flex gap-4 p-3">
        <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-1 bg-sink">
          <Thumbnail
            src={info.thumbnail}
            pageUrl={info.webpageUrl}
            className="h-full w-full object-cover"
            loading="eager"
            fallback={<div className="h-full w-full bg-sink" />}
          />
          {info.isLive && (
            <span className="absolute left-1.5 top-1.5 rounded-pill bg-bad px-2 py-0.5 text-caption font-bold leading-none text-bad-fg">
              {t('home.liveBadge')}
            </span>
          )}
          {info.duration != null && info.duration > 0 && !info.isLive && (
            <span className="numeric absolute bottom-1.5 right-1.5 rounded-1 bg-osd px-1.5 py-0.5 text-caption leading-none text-osd-fg">
              {formatDuration(info.duration)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <h2 className="text-heading line-clamp-2 text-ink" title={info.title}>
            {info.title}
          </h2>
          {meta && <p className="numeric mt-1 truncate text-meta text-ink-2">{meta}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="tag">{info.extractor}</span>
            {maxHeightOf(info.formats) > 0 && (
              <span className="tag">{t('format.upTo', { height: maxHeightOf(info.formats) })}</span>
            )}
            {info.subtitleLanguages && info.subtitleLanguages.length > 0 && (
              <span className="tag">{tp('format.subtitles', info.subtitleLanguages.length)}</span>
            )}
            {info.viaUniversal && (
              <span className="tag text-accent-ink" title={t('home.universalHint')}>
                {t('home.universal')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Already kept: the file is one press away, and fetching it again is still a choice. */}
      {held && (
        <div className="panel flex flex-wrap items-center gap-3 p-3" data-uvd="already-have">
          <CheckCircle2 size={18} className="shrink-0 text-accent-ink" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-ink">{t('library.haveTitle')}</p>
            <p className="numeric truncate text-meta text-ink-2" title={held.onDisk ? held.entry.filepath : held.entry.remotePath}>
              {held.onDisk
                ? [
                    held.entry.container?.toUpperCase(),
                    held.entry.sizeBytes ? formatBytes(held.entry.sizeBytes) : null,
                    new Date(held.entry.finishedAt).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('queue.onShare', { path: held.entry.remotePath ?? '' })}
            </p>
          </div>
          {held.onDisk && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn-solid"
                onClick={() =>
                  void window.api.openPath(held.entry.filepath).then((why) => {
                    if (why) toast(t('queue.openFailed'), 'error')
                  })
                }
              >
                <Play size={14} /> {t('common.play')}
              </button>
              <button type="button" className="btn-quiet" onClick={() => void window.api.showInFolder(held.entry.filepath)}>
                <FolderOpen size={14} /> {t('common.showInFolder')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* The choices, as one boxed list. */}
      <PreferencesGroup footer={info.isLive ? t('home.liveHint') : undefined}>
        <ComboRow
          id="result-format"
          title={t('common.whatToDownload')}
          value={mode}
          onChange={(v) => select({ mode: v as DownloadMode })}
          options={[
            { value: 'video', label: t('common.video') },
            { value: 'audio', label: t('common.audioOnly') }
          ]}
        />
        {mode === 'video' ? (
          <ComboRow
            id="result-quality"
            title={t('common.quality')}
            subtitle={youGet}
            value={qualityValue}
            onChange={(v) => (v.startsWith('fmt:') ? undefined : select({ quality: v as QualityPreset, formatId: undefined }))}
            options={qualityOptions}
          />
        ) : (
          <ComboRow
            id="result-audio-format"
            title={t('format.audioFormat')}
            subtitle={youGet}
            value={settings.audioFormat}
            onChange={onAudioFormat}
            options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
          />
        )}
        {mode === 'video' && videoFormats.length > 1 && (
          <ExpanderRow
            id="result-stream"
            title={t('format.exactStreamTitle')}
            subtitle={chosenFormat ? `${chosenFormat.resolution} · ${chosenFormat.ext.toUpperCase()}` : tp('format.streams', videoFormats.length)}
            expandLabel={t('format.exactStreamTitle')}
          >
            {/* Data rows: one radio per stream, the facts aligned so they compare. */}
            <div role="radiogroup" aria-label={t('format.exactStreamTitle')} className="max-h-56 overflow-y-auto">
              {videoFormats.map((f) => {
                const on = selection.formatId === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => select({ formatId: f.id })}
                    className={cx(
                      'flex min-h-[40px] w-full items-center gap-3 px-3 text-left transition-colors duration-fast ease-ease',
                      on ? 'bg-fill/10' : 'hover:bg-fill/[0.04]'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cx('h-2 w-2 shrink-0 rounded-full', on ? 'bg-accent' : 'bg-fill/25')}
                    />
                    <span className="numeric w-20 shrink-0 text-control text-ink">{f.resolution}</span>
                    {/* As on any selected row, the fill takes the dim tier under 4.5:1 at night. */}
                    <span className={cx('w-12 shrink-0 text-control uppercase', on ? 'text-ink' : 'text-ink-2')}>{f.ext}</span>
                    <span className={cx('min-w-0 flex-1 truncate text-control', on ? 'text-ink' : 'text-ink-2')}>
                      {f.vcodec?.split('.')[0]}
                      {f.kind === 'video' ? ` ${t('format.plusAudio')}` : ''}
                    </span>
                    <span className={cx('numeric shrink-0 text-control', on ? 'text-ink' : 'text-ink-2')}>
                      {formatBytes(f.filesize || f.filesizeApprox)}
                    </span>
                  </button>
                )
              })}
            </div>
          </ExpanderRow>
        )}
        {languages.length > 0 && (
          <ComboRow
            id="result-audio-language"
            title={t('format.audioLanguage')}
            value={choice.audioLanguage ?? ''}
            onChange={(v) => onChoice({ ...choice, audioLanguage: v || undefined })}
            options={[
              // What the site would have served anyway, named when the site says which that is.
              {
                value: '',
                label: originalLanguage
                  ? t('format.audioOriginal', { language: languageName(originalLanguage.code, locale, t) })
                  : t('format.audioDefault')
              },
              ...languages
                .filter((l) => !l.original)
                .map((l) => ({ value: l.code, label: languageName(l.code, locale, t) }))
            ]}
          />
        )}
        {mode === 'video' && (
          <SubtitlesRow
            info={info}
            settings={settings}
            value={choice.subtitles}
            onChange={(subtitles) => onChoice({ ...choice, subtitles })}
          />
        )}
        {/*
          A live stream has no end, so it has no section to cut out of it. The
          cut is fetched on its own by the engine: a highlight out of a long
          stream costs seconds instead of the whole file.
        */}
        {mode === 'video' && !info.isLive && (
          <ExpanderRow
            id="result-cut"
            title={t('trim.rowTitle')}
            subtitle={
              cutting
                ? `${toClock(choice.section.start ?? 0)}${choice.section.end != null ? ` → ${toClock(choice.section.end)}` : ' →'}`
                : t('trim.downloadHint')
            }
            enabled={choice.trimOn}
            onEnabledChange={(on) => onChoice({ ...choice, trimOn: on })}
            expandLabel={t('trim.rowTitle')}
          >
            <div className="space-y-4 p-3">
              <TrimEditor
                duration={info.duration}
                value={choice.section}
                onChange={(section) => onChoice({ ...choice, section, trimOn: true })}
                hint={t('trim.downloadHint')}
              />
            </div>
            <ActionRow
              title={t('trim.precise')}
              subtitle={choice.precise ? t('trim.preciseHint') : t('trim.fastHint')}
              suffix={
                <SegmentedControl
                  label={t('trim.precise')}
                  value={choice.precise ? 'precise' : 'fast'}
                  onChange={(v) => onChoice({ ...choice, precise: v === 'precise' })}
                  options={[
                    { value: 'precise', label: t('trim.preciseShort') },
                    { value: 'fast', label: t('trim.fastShort') }
                  ]}
                />
              }
            />
          </ExpanderRow>
        )}
        <ActionRow
          id="result-save-to"
          title={t('home.saveTo')}
          subtitle={<span title={saveDir || settings.downloadDir}>{saveDir || settings.downloadDir}</span>}
          monoSubtitle
          suffix={
            <>
              {saveDir && (
                <button type="button" className="btn-quiet" onClick={() => onSaveDir('')}>
                  {t('home.saveDefault')}
                </button>
              )}
              <button type="button" className="btn-quiet" onClick={() => void chooseDir()}>
                <Folder size={14} /> {t('common.change')}
              </button>
            </>
          }
        />
      </PreferencesGroup>

      {/*
        The pill says what it will fetch. A cut keeps its own verb: its size is
        a part of the file's, and a full-file figure next to it would be a
        number for something else.
      */}
      <div className="flex justify-center">
        <button
          type="button"
          className={cx(
            // Play above is the suggested action then; this one is still there, not shouting.
            again ? 'btn-quiet' : 'btn-solid',
            'h-11 min-w-[60%] max-w-full rounded-pill px-8 text-body'
          )}
          data-uvd="download"
          onClick={onDownload}
          disabled={starting}
        >
          {starting ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className="truncate">
            {cutting
              ? t('trim.apply')
              : again
                ? [t('library.downloadAnyway'), ...summary].join(' · ')
                : summary.length
                ? t('home.downloadSummary', { details: summary.join(' · ') })
                : t('common.download')}
          </span>
        </button>
      </div>
    </m.div>
  )
}
