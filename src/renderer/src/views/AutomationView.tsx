import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  Clock,
  Download,
  Film,
  FolderUp,
  Loader2,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X
} from 'lucide-react'
import { enter } from '../lib/motion'
import { useStore } from '../store'
import { resolveLanguage, useT, type TranslateFn, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import { describeCheck } from '../lib/checkSummary'
import Thumbnail from '../components/Thumbnail'
import EmptyState from '../components/EmptyState'
import { span, type SpanUnit } from '../lib/span'
import { releaseDate, releaseText } from '../lib/release'
import type { WatchIntent } from '../store'
import ConfirmDialog from '../components/ConfirmDialog'
import AddWatchDialog from '../components/AddWatchDialog'
import StepEditor from '../components/StepEditor'
import { RUN_LABEL, STEP_LABEL } from '../lib/automationLabels'
import {
  attemptsAt,
  byStepOrder,
  MAX_ATTEMPTS,
  STEP_ORDER,
  upcomingDelayMinutes,
  watchFailing,
  type PipelineStep,
  type Run,
  type StepKind,
  type Watch
} from '@shared/automation'
import type { DownloadItem } from '@shared/types'

/**
 * Watching series, and what happens when one produces an episode.
 *
 * Two panes: the list on the left, the selected series on the right. The same
 * arrangement a desktop chat app uses, for the same reason — many small things
 * of which one is open at a time — so it needs no explaining.
 */

const STEP_ICON: Record<StepKind, JSX.Element> = {
  download: <Download size={15} />,
  rename: <Pencil size={15} />,
  upload: <FolderUp size={15} />,
  notify: <Send size={15} />
}

/** Steps a watch can gain, in the order they would run. Derived, so the two lists cannot drift apart. */
const ADDABLE: StepKind[] = STEP_ORDER.filter((k) => k !== 'download')

/*
  Units are looked up, never written: the first version said "in 2 h" in a
  Russian interface, which is the kind of seam that makes translated software
  feel translated. Spelled out as literals so the dictionary check can see them.
*/
const UNIT: Record<SpanUnit, 'time.min' | 'time.h' | 'time.d'> = {
  min: 'time.min',
  h: 'time.h',
  d: 'time.d'
}

function spanText(minutes: number, t: TranslateFn): string {
  const { n, unit } = span(minutes)
  return `${n} ${t(UNIT[unit])}`
}

/** "every 6 h", "every day" - the interval as a person would say it. */
function every(minutes: number, t: TranslateFn): string {
  return minutes === 1440 ? t('auto.everyDay') : t('auto.everyN', { span: spanText(minutes, t) })
}

function relative(at: number | undefined, t: TranslateFn): string {
  if (!at) return ''
  const delta = at - Date.now()
  const mins = Math.round(Math.abs(delta) / 60_000)
  if (mins < 1) return t('auto.soon')
  const text = spanText(mins, t)
  return delta > 0 ? `${t('auto.in')} ${text}` : `${text} ${t('auto.ago')}`
}

/**
 * How long ago something happened.
 *
 * Not `relative`, whose first minute reads "any moment" - right for a check
 * that is due, wrong for a run that has just started or an episode that has
 * just failed, both of which now turn up on screen the moment they happen.
 */
function ago(at: number, t: TranslateFn): string {
  const mins = Math.round((Date.now() - at) / 60_000)
  return mins < 1 ? t('auto.justNow') : `${spanText(mins, t)} ${t('auto.ago')}`
}

/*
  How often the screen redraws on its own. Every time it shows is relative to
  now, and with nothing to redraw it, "in 5 min" sat there for an hour while
  the view stayed open. Half a minute keeps a minute-grained clock honest.
*/
const CLOCK_MS = 30_000

/*
  How far the queue item a running episode drives has got. Literals for the
  dictionary check; the finished states are absent because by then the run
  has moved past its download step.
*/
const QUEUE_LABEL: Partial<Record<DownloadItem['state'], TranslationKey>> = {
  queued: 'state.queued',
  detecting: 'state.detecting',
  downloading: 'state.downloading',
  processing: 'state.processing'
}

/**
 * The queue row behind a running episode, and the way to it.
 *
 * A run whose download was paused - by hand, or by "pause all" - used to read
 * "running" here for as long as anybody cared to look, with nothing to say the
 * reason was a paused row on another screen. Its own component so a download's
 * progress redraws this line rather than the whole screen.
 */
function QueueLink({ id }: { id: string }): JSX.Element | null {
  const t = useT()
  const item = useStore((s) => s.downloads.find((d) => d.id === id))
  const setView = useStore((s) => s.setView)
  if (!item) return null
  const paused = item.state === 'paused'
  const label = QUEUE_LABEL[item.state]
  const percent = item.state === 'downloading' ? ` · ${Math.round(item.percent || 0)}%` : ''
  const text = paused ? t('auto.runQueuePaused') : label ? `${t(label)}${percent}` : ''
  // Finished: the run is past its download step, or about to say why not.
  if (!text) return null
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span
        className={`mono min-w-0 flex-1 truncate text-[11px] ${paused ? 'text-warn' : 'text-ink-2'}`}
      >
        {text}
      </span>
      <button className="btn-quiet px-3 py-1 text-[12px]" onClick={() => setView('downloads')}>
        {t('auto.showInQueue')}
      </button>
    </div>
  )
}

export default function AutomationView(): JSX.Element {
  const t = useT()
  const [watches, setWatches] = useState<Watch[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** `true` from the add button; an intent when the home screen sent a series over. */
  const [adding, setAdding] = useState<boolean | WatchIntent>(false)
  const [editing, setEditing] = useState<PipelineStep | StepKind | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  /*
    Per watch, not one flag for the screen: with a single boolean, picking
    another series while one was being checked showed its button spinning and
    disabled too.
  */
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set())
  /** The list has been read once, so an empty one means nothing is watched rather than not yet known. */
  const [loaded, setLoaded] = useState(false)
  const settings = useStore((s) => s.settings)
  const takePendingWatch = useStore((s) => s.takePendingWatch)
  const locale = useStore((s) =>
    resolveLanguage(s.settings?.language ?? 'auto', s.appInfo?.locale ?? 'en')
  )

  /*
    A series handed over from the home screen opens the dialog already filled
    in - or, when it is watched already, opens that watch.
  */
  useEffect(() => {
    const intent = takePendingWatch()
    if (intent?.watchId) setSelectedId(intent.watchId)
    else if (intent) setAdding(intent)
  }, [takePendingWatch])

  const selected = useMemo(
    () => watches.find((w) => w.id === selectedId) ?? null,
    [watches, selectedId]
  )

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.api.autoList()
    setWatches(list)
    setLoaded(true)
    setSelectedId((current) => current ?? list[0]?.id ?? null)
    // The mark on the tab reads the same list; keep the two from disagreeing.
    void useStore.getState().refreshWatchAlerts()
  }, [])

  useEffect(() => {
    void refresh()
    return window.api.onAutomationChanged(() => void refresh())
  }, [refresh])

  const [, setClock] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setRuns([])
      return
    }
    let cancelled = false
    void window.api.autoRuns(selectedId).then((r) => !cancelled && setRuns(r))
    return () => {
      cancelled = true
    }
  }, [selectedId, watches])

  const patch = async (changes: Partial<Watch>): Promise<void> => {
    if (!selected) return
    await window.api.autoUpdate(selected.id, changes)
    await refresh()
  }

  const checkNow = async (): Promise<void> => {
    if (!selected) return
    const id = selected.id
    setChecking((current) => new Set(current).add(id))
    try {
      const summary = await window.api.autoCheckNow(id)
      await refresh()
      const { text, kind } = describeCheck(summary, t, (at) => releaseDate(at, locale))
      toast(text, kind)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setChecking((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  /*
    A failed episode had no way back short of fetching and uploading it by
    hand - not even after fixing the password that made it fail. Answers at
    once; the new run replaces this one in the list as it goes.
  */
  const retry = async (run: Run): Promise<void> => {
    try {
      const answer = await window.api.autoRetryRun(run.id)
      await refresh()
      if ('started' in answer) toast(t('auto.retryStarted'), 'success')
      else if ('busy' in answer) toast(t('auto.checkBusy'), 'info')
      else if ('paused' in answer) toast(t('auto.retryPaused'), 'info')
      else toast(answer.error, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const saveStep = async (step: PipelineStep): Promise<void> => {
    if (!selected) return
    const exists = selected.steps.some((s) => s.id === step.id)
    const steps = exists
      ? selected.steps.map((s) => (s.id === step.id ? step : s))
      : [...selected.steps, step].sort(byStepOrder)
    await patch({ steps })
    setEditing(null)
  }

  const removeStep = async (id: string): Promise<void> => {
    if (!selected) return
    await patch({ steps: selected.steps.filter((s) => s.id !== id) })
    setEditing(null)
  }

  const missing = ADDABLE.filter((k) => !selected?.steps.some((s) => s.kind === k))

  /*
    Nothing watched: the screen's title and the one way to add something. The
    list beside it used to stay, an empty third of the window with a second
    "add" button at the top of it.
  */
  const empty = loaded && watches.length === 0

  return (
    <div className="flex h-full min-h-0">
      {/* ---- the list ---- */}
      {!empty && (
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-edge">
          <div className="flex items-center gap-2 border-b border-edge px-3 pb-3 pt-8">
            <h1 className="h1 min-w-0 flex-1 truncate">{t('auto.title')}</h1>
            <button className="btn-solid px-2.5 py-1.5" onClick={() => setAdding(true)}>
              <Plus size={14} /> {t('auto.add')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {watches.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                className={`flex w-full items-center gap-3 border-b border-edge px-3 py-2.5 text-left transition-colors ${
                  w.id === selectedId ? 'bg-raise' : 'hover:bg-raise/60'
                }`}
              >
                <Thumbnail
                  src={w.thumbnail}
                  alt=""
                  className="h-12 w-9 shrink-0 rounded"
                  fallback={<Film size={14} className="text-ink-3" />}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink" title={w.title}>
                    {w.title}
                  </span>
                  <span className="mono block truncate text-[11px] text-ink-2">
                    {w.enabled
                      ? w.lastError
                        ? t('auto.failing')
                        : w.lastRunError
                          ? t('auto.runFailing')
                          : w.pending
                            ? releaseText(w.releaseAt, t)
                            : relative(w.nextCheckAt, t)
                      : t('auto.paused')}
                  </span>
                </span>
                {!w.enabled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />}
                {watchFailing(w) && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
                )}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* ---- the selected series ---- */}
      <motion.section
        key={selectedId ?? 'none'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={enter}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {empty ? (
          <div className="mx-auto flex h-full w-full max-w-[860px] flex-col px-6 pb-8 pt-10">
            <h1 className="h1">{t('auto.title')}</h1>
            <div className="min-h-0 flex-1">
              <EmptyState
                icon={<Radar size={22} />}
                title={t('auto.empty')}
                hint={t('auto.emptyHint')}
                action={
                  <button className="btn-solid" onClick={() => setAdding(true)}>
                    <Plus size={14} /> {t('auto.add')}
                  </button>
                }
              />
            </div>
          </div>
        ) : !loaded ? null : !selected ? (
          <div className="flex h-full items-center justify-center">
            <p className="hint">{t('auto.pickOne')}</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[720px] px-6 py-6">
            <header className="flex gap-4">
              <Thumbnail
                src={selected.thumbnail}
                alt=""
                className="h-28 w-20 shrink-0 rounded"
                fallback={<Film size={20} className="text-ink-3" />}
              />
              <div className="min-w-0 flex-1">
                <h2 className="h2 truncate" title={selected.title}>
                  {selected.title}
                </h2>
                <p className="hint mt-1 truncate">
                  {[selected.translatorName, selected.quality].filter(Boolean).join(' · ')}
                </p>
                {selected.pending && (
                  <p className="mt-1 text-[13px] text-ink">
                    {releaseText(selected.releaseAt, t)}
                    {selected.releaseAt
                      ? ` · ${t('auto.releaseOn', {
                          date: releaseDate(selected.releaseAt, locale)
                        })}`
                      : ''}
                  </p>
                )}
                <p className="mono mt-1 text-[12px] text-ink-2">
                  <Clock size={11} className="mr-1 inline" />
                  {selected.enabled
                    ? `${t('auto.nextCheck')} ${relative(selected.nextCheckAt, t)}`
                    : t('auto.paused')}
                  {' · '}
                  {/* While it is waiting, the pace is the waiting pace - say that one. */}
                  {every(
                    selected.pending
                      ? upcomingDelayMinutes(selected.releaseAt, selected.intervalMinutes, Date.now())
                      : selected.intervalMinutes,
                    t
                  )}
                </p>
                {selected.lastError && (
                  <p className="hint mt-1 text-bad">{selected.lastError}</p>
                )}
                {/*
                  Only an episode that gets all the way through clears this, and
                  one that has been given up on never will, so it can be put
                  away by hand once it has been seen.
                */}
                {selected.lastRunError && (
                  <div className="mt-1 flex items-start gap-1">
                    <p className="hint min-w-0 flex-1 text-bad">
                      {selected.lastRunFailedAt
                        ? t('auto.runFailedAt', { when: ago(selected.lastRunFailedAt, t) })
                        : t('auto.runFailing')}
                      {': '}
                      {selected.lastRunError}
                    </p>
                    <button
                      className="btn-icon-bare -my-1 h-7 w-7"
                      aria-label={t('auto.dismissRunError')}
                      title={t('auto.dismissRunError')}
                      onClick={() =>
                        void patch({ lastRunError: undefined, lastRunFailedAt: undefined })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            </header>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-quiet"
                onClick={() => void patch({ enabled: !selected.enabled })}
              >
                {selected.enabled ? t('auto.pause') : t('auto.resume')}
              </button>
              <button
                className="btn-quiet"
                onClick={() => void checkNow()}
                disabled={checking.has(selected.id)}
              >
                {checking.has(selected.id) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t('auto.checkNow')}
              </button>
              <select
                className="field w-auto text-[13px]"
                aria-label={t('auto.interval')}
                value={String(selected.intervalMinutes)}
                onChange={(e) => void patch({ intervalMinutes: Number(e.target.value) })}
              >
                {[15, 30, 60, 180, 360, 720, 1440].map((n) => (
                  <option key={n} value={n}>
                    {every(n, t)}
                  </option>
                ))}
              </select>
              <button className="btn-danger ml-auto" onClick={() => setConfirmRemove(true)}>
                <Trash2 size={14} /> {t('auto.remove')}
              </button>
            </div>

            {/* ---- the chain ---- */}
            <h3 className="label mt-8 border-b border-edge pb-2">{t('auto.pipeline')}</h3>
            <div className="mt-3 space-y-2">
              <div className="panel flex items-center gap-3 px-3 py-2.5 opacity-80">
                {STEP_ICON.download}
                <span className="flex-1 text-[13px] text-ink">{t('auto.step.download')}</span>
                <span className="hint">{t('auto.always')}</span>
              </div>

              {/* In the order they run, which a watch saved before this need not be stored in. */}
              {selected.steps
                .filter((s) => s.kind !== 'download')
                .sort(byStepOrder)
                .map((step) => (
                  <div key={step.id}>
                    <button
                      onClick={() => setEditing(step)}
                      className="panel flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-raise"
                    >
                      {STEP_ICON[step.kind]}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-ink">
                          {t(STEP_LABEL[step.kind])}
                        </span>
                        <span className="mono block truncate text-[11px] text-ink-2">
                          {step.kind === 'rename' && step.template}
                          {step.kind === 'upload' &&
                            `${step.remotePath} · ${t(step.deleteLocalAfter ? 'auto.localDeleted' : 'auto.localKept')}`}
                          {step.kind === 'notify' &&
                            settings?.telegramChatId &&
                            t('auto.notifyTo', { id: settings.telegramChatId })}
                        </span>
                      </span>
                      {step.enabled ? (
                        <Check size={14} className="text-good" />
                      ) : (
                        <X size={14} className="text-ink-3" />
                      )}
                    </button>
                    {/*
                      On the screen, not only inside the editor: tucked away there,
                      nobody found it, and every episode stayed on the computer as
                      well as on the share.
                    */}
                    {step.kind === 'upload' && (
                      <label className="mt-1.5 flex cursor-pointer items-center gap-2.5 px-3 text-[13px] text-ink-2">
                        <input
                          type="checkbox"
                          checked={step.deleteLocalAfter}
                          onChange={(e) => void saveStep({ ...step, deleteLocalAfter: e.target.checked })}
                        />
                        {t('auto.deleteLocal')}
                      </label>
                    )}
                  </div>
                ))}

              {missing.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {missing.map((kind) => (
                    <button key={kind} className="btn-quiet" onClick={() => setEditing(kind)}>
                      <Plus size={14} /> {t(STEP_LABEL[kind])}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ---- what has happened ---- */}
            <h3 className="label mt-8 border-b border-edge pb-2">{t('auto.history')}</h3>
            {runs.length === 0 ? (
              <p className="hint mt-3">{t('auto.noRuns')}</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {runs.map((run) => (
                  <li key={run.id} className="panel px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[12px] text-ink">
                        S{String(run.season).padStart(2, '0')}E
                        {String(run.episode).padStart(2, '0')}
                      </span>
                      <span
                        className={`label ${
                          run.state === 'failed'
                            ? 'text-bad'
                            : run.state === 'done'
                              ? 'text-good'
                              : 'text-ink-2'
                        }`}
                      >
                        {t(RUN_LABEL[run.state])}
                      </span>
                      <span className="mono ml-auto text-[11px] text-ink-3">
                        {ago(run.startedAt, t)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {/* A copy: runs recorded before steps were kept in order are shown in it too. */}
                      {[...run.steps].sort(byStepOrder).map((s, i) => (
                        <span
                          key={i}
                          className={`mono text-[11px] ${
                            s.state === 'failed'
                              ? 'text-bad'
                              : s.state === 'done'
                                ? 'text-ink-2'
                                : 'text-ink-3'
                          }`}
                          title={s.message}
                        >
                          {t(STEP_LABEL[s.kind])}
                          {(s.state === 'failed' || (run.state === 'skipped' && s.state === 'skipped')) &&
                          s.message
                            ? `: ${s.message}`
                            : ''}
                        </span>
                      ))}
                    </div>
                    {run.state === 'running' && run.downloadId && (
                      <QueueLink id={run.downloadId} />
                    )}
                    {(run.state === 'failed' || run.state === 'skipped') && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="mono min-w-0 flex-1 truncate text-[11px] text-ink-2">
                          {/* Counted on the watch only while the schedule still means to try again. */}
                          {run.state === 'failed' && attemptsAt(selected, run) > 0
                            ? t('auto.runWillRetry', {
                                n: attemptsAt(selected, run),
                                max: MAX_ATTEMPTS
                              })
                            : ''}
                        </span>
                        <button
                          className="btn-quiet px-3 py-1 text-[12px]"
                          onClick={() => void retry(run)}
                        >
                          <RotateCcw size={12} /> {t('auto.retryRun')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </motion.section>

      {adding && (
        <AddWatchDialog
          initial={typeof adding === 'object' ? adding : undefined}
          onClose={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false)
            await refresh()
            setSelectedId(id)
          }}
        />
      )}

      {editing && selected && (
        <StepEditor
          step={editing}
          onSave={saveStep}
          onRemove={removeStep}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmRemove && selected && (
        <ConfirmDialog
          title={t('auto.removeConfirm')}
          body={t('auto.removeConfirmBody', { title: selected.title })}
          confirmLabel={t('auto.remove')}
          onConfirm={async () => {
            setConfirmRemove(false)
            await window.api.autoRemove(selected.id)
            setSelectedId(null)
            await refresh()
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
