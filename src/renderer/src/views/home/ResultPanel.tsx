import { m } from 'framer-motion'
import { enter } from '../../lib/motion'
import { Globe, RotateCw } from '../../ui/icons'
import type { AppSettings, MediaInfo } from '@shared/types'
import { errorReport, errorText } from '../../lib/errors'
import { fixFor } from '../../lib/fixes'
import FixBar from '../../components/FixBar'
import { errorLead } from '../../lib/emphasis'
import { useT } from '../../i18n'
import { useStore } from '../../store'
import PlaylistCard from '../../components/PlaylistCard'
import StreamingCard from '../../components/StreamingCard'
import ReportPrompt from '../../components/ReportPrompt'
import VideoResult, { type ResultChoice } from './VideoResult'
import type { DetectFailure, DetectStatus } from './hooks'

interface Props {
  status: DetectStatus
  info: MediaInfo | null
  failure: DetectFailure
  settings: AppSettings | null
  /** The text in the entry, for "Open in Built-in Browser". */
  url: string
  /** The link the card on screen came from. */
  detectedUrl: string
  choice: ResultChoice
  onChoice: (next: ResultChoice) => void
  saveDir: string
  onSaveDir: (dir: string) => void
  onDownload: () => void
  onRetry: () => void
  /** The "Audio Only" fix: queue the link as audio without the format list. */
  onAudioOnly: () => void
  /** A series or playlist card queued what it was asked to. */
  onDone: () => void
  starting: boolean
}

/**
 * What a detect came back with (5.4): an error, a series picker, a playlist,
 * or one video's card. The states are mutually exclusive and swap at once,
 * with no exit animation: an exiting child in a throttled background window
 * never reports its animation finished and stays in flow under the new one.
 */
export default function ResultPanel({
  status,
  info,
  failure,
  settings,
  url,
  detectedUrl,
  choice,
  onChoice,
  saveDir,
  onSaveDir,
  onDownload,
  onRetry,
  onAudioOnly,
  onDone,
  starting
}: Props): JSX.Element | null {
  const saveSettings = useStore((s) => s.saveSettings)

  if (status === 'error') {
    return (
      <ErrorCard
        failure={failure}
        url={url}
        onRetry={onRetry}
        onAudioOnly={onAudioOnly}
        onChangeFolder={(dir) => {
          onSaveDir(dir)
          onRetry()
        }}
      />
    )
  }
  if (!info || status !== 'idle') return null
  if (info.streaming) {
    return (
      <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter}>
        <StreamingCard info={info} onDone={onDone} saveDir={saveDir} onSaveDirChange={onSaveDir} />
      </m.div>
    )
  }
  if (info.isPlaylist) {
    return (
      <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter}>
        <PlaylistCard info={info} onDone={onDone} saveDir={saveDir} onSaveDirChange={onSaveDir} />
      </m.div>
    )
  }
  if (!settings) return null
  return (
    <VideoResult
      info={info}
      detectedUrl={detectedUrl}
      settings={settings}
      choice={choice}
      onChoice={onChoice}
      onAudioFormat={(fmt) => void saveSettings({ audioFormat: fmt })}
      saveDir={saveDir}
      onSaveDir={onSaveDir}
      onDownload={onDownload}
      starting={starting}
    />
  )
}

/** A detect that failed: what to do about it first, the engine's own words second. */
function ErrorCard({
  failure,
  url,
  onRetry,
  onAudioOnly,
  onChangeFolder
}: {
  failure: DetectFailure
  url: string
  onRetry: () => void
  onAudioOnly: () => void
  onChangeFolder: (dir: string) => void
}): JSX.Element {
  const t = useT()
  const { error, errorCode, cookieHint, reported } = failure
  const retryLeads = errorLead(errorCode) === 'retry'
  const fix = fixFor(errorCode, cookieHint)
  return (
    <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={enter} className="panel overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-edge-soft px-4 py-3">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
        <p className="text-heading text-ink">{t('home.errorTitle')}</p>
      </div>
      <div className="p-4">
        <p className="selectable break-words text-body leading-relaxed text-ink">{errorText(t, { error, errorCode, cookieHint })}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* The honest escape hatch, unless the fix below already is it. */}
          {fix !== 'browser' && (
            <button
              type="button"
              className={retryLeads || fix ? 'btn-quiet' : 'btn-solid'}
              onClick={() => window.api.openBrowser(url || undefined)}
            >
              <Globe size={14} /> {t('browser.open')}
            </button>
          )}
          <button type="button" className={retryLeads ? 'btn-solid' : 'btn-quiet'} onClick={onRetry}>
            <RotateCw size={14} /> {t('common.retry')}
          </button>
        </div>
        {/* 6.2: what this failure's code says to try, then Report and Copy Error. */}
        <FixBar
          errorCode={errorCode}
          cookieHint={cookieHint}
          url={url}
          retryKey={`detect:${url}`}
          copyText={errorReport(t, { error, errorCode, cookieHint })}
          onRetry={onRetry}
          onAudioOnly={onAudioOnly}
          onChangeFolder={onChangeFolder}
        />
        <p className="hint mt-3">{t('browser.openHint')}</p>
        {/* Keyed by the failure, so a retry that fails again asks afresh. */}
        {reported && (
          <ReportPrompt key={reported.id} reportId={reported.id} stage="detect" url={reported.url} errorCode={errorCode} />
        )}
      </div>
    </m.div>
  )
}
