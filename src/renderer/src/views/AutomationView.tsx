import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { m } from 'framer-motion'
import {
  Check,
  Download,
  ExternalLink,
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
} from '../ui/icons'
import { enter } from '../lib/motion'
import { useStore } from '../store'
import { resolveLanguage, useT, type TranslateFn, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import { describeCheck } from '../lib/checkSummary'
import AutomationSettings from '../components/AutomationSettings'
import HeaderSlot from '../shell/HeaderSlot'
import { ActionRow, ComboRow, EmptyState, Icon, IconButton, PreferencesGroup, PreferencesPage, Switch, SwitchRow } from '../ui'
import { span, type SpanUnit } from '../lib/span'
import { releaseDate, releaseText } from '../lib/release'
import type { WatchIntent } from '../store'
import ConfirmDialog from '../components/ConfirmDialog'
import AddWatchDialog, { Poster } from '../components/AddWatchDialog'
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
        className={`numeric min-w-0 flex-1 truncate text-caption ${paused ? 'text-warn' : 'text-ink-2'}`}
      >
        {text}
      </span>
      <button className="btn-quiet px-3 py-1 text-meta" onClick={() => setView('downloads')}>
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

  /** "S01E05": the newest episode this watch has seen, i.e. the last new one. */
  const lastEpisode = (w: Watch): string | null => {
    if (!w.seen.length) return null
    const top = w.seen.reduce((a, e) => (e.season > a.season || (e.season === a.season && e.episode > a.episode) ? e : a))
    return `S${String(top.season).padStart(2, '0')}E${String(top.episode).padStart(2, '0')}`
  }

  const statusLine = (w: Watch): string =>
    w.enabled
      ? w.lastError
        ? t('auto.failing')
        : w.lastRunError
          ? t('auto.runFailing')
          : w.pending
            ? releaseText(w.releaseAt, t)
            : `${t('auto.nextCheck')} ${relative(w.nextCheckAt, t)}`
      : t('auto.paused')

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {/* A1 §3: a header "+" opens the add dialog. */}
      <HeaderSlot>
        <IconButton label={t('auto.addTitle')} icon={<Plus size={16} />} onClick={() => setAdding(true)} data-uvd="watch-add" />
      </HeaderSlot>

      {empty ? (
        <EmptyState
          icon={<Icon icon={Radar} size="xl" />}
          title={t('auto.empty')}
          hint={t('auto.emptyHint')}
          action={
            <button type="button" className="btn-solid rounded-pill px-6" onClick={() => setAdding(true)}>
              <Plus size={14} /> {t('auto.addTitle')}
            </button>
          }
        />
      ) : !loaded ? null : (
        <PreferencesPage width="medium">
          {/* ---- every series: poster, dub, next check, last new episode, a pause switch ---- */}
          <PreferencesGroup title={t('auto.series')} description={t('automation.lead')}>
            {watches.map((w) => {
              const on = w.id === selectedId
              const last = lastEpisode(w)
              return (
                <div key={w.id} data-row={`watch-${w.id}`} className={`ui-row gap-0 p-0 ${on ? 'bg-fill/10' : 'hover:bg-fill/[0.04]'}`}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedId(w.id)}
                    className="no-drag flex min-w-0 flex-1 items-center gap-3 self-stretch px-3 py-2 text-left outline-offset-[-2px]"
                  >
                    <Poster src={w.thumbnail} />
                    <span className="min-w-0 flex-1">
                      <span className="ui-row-title block truncate" title={w.title}>
                        {w.title}
                      </span>
                      {/* The selected row's fill is what took the dim tier under 4.5:1 at night. */}
                      <span className={`ui-row-subtitle block truncate ${on ? 'text-ink' : 'text-ink-2'}`}>
                        {[w.translatorName, w.quality].filter(Boolean).join(' · ')}
                      </span>
                      <span className={`numeric block truncate text-meta ${watchFailing(w) ? 'text-bad' : on ? 'text-ink' : 'text-ink-2'}`}>
                        {statusLine(w)}
                        {last ? ` · ${t('auto.lastNew', { episode: last })}` : ''}
                      </span>
                    </span>
                  </button>
                  <span className="px-3">
                    <Switch
                      aria-label={`${t('auto.watchSwitch')}: ${w.title}`}
                      checked={w.enabled}
                      onChange={(enabled) => void window.api.autoUpdate(w.id, { enabled }).then(refresh)}
                    />
                  </span>
                </div>
              )
            })}
          </PreferencesGroup>

          {!selected ? null : (
            <m.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={enter} className="space-y-6">
              {/* ---- the selected series ---- */}
              <PreferencesGroup
                title={selected.title}
                suffix={
                  <div className="flex items-center gap-1.5">
                    {/* The series page itself, in the system browser: to see what came out, or check the dub. */}
                    <button type="button" className="btn-quiet" onClick={() => void window.api.openExternal(selected.url)}>
                      <ExternalLink size={14} /> {t('common.openInBrowser')}
                    </button>
                    <button type="button" className="btn-quiet" onClick={() => void checkNow()} disabled={checking.has(selected.id)}>
                      {checking.has(selected.id) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {t('auto.checkNow')}
                    </button>
                    <button type="button" className="btn-quiet text-bad" onClick={() => setConfirmRemove(true)}>
                      <Trash2 size={14} /> {t('auto.remove')}
                    </button>
                  </div>
                }
              >
                <ActionRow
                  title={[selected.translatorName, selected.quality].filter(Boolean).join(' · ') || selected.title}
                  subtitle={
                    selected.pending
                      ? `${releaseText(selected.releaseAt, t)}${selected.releaseAt ? ` · ${t('auto.releaseOn', { date: releaseDate(selected.releaseAt, locale) })}` : ''}`
                      : statusLine(selected)
                  }
                  prefix={<Poster src={selected.thumbnail} size="lg" />}
                />
                <ComboRow
                  title={t('auto.interval')}
                  subtitle={
                    selected.pending
                      ? every(upcomingDelayMinutes(selected.releaseAt, selected.intervalMinutes, Date.now()), t)
                      : undefined
                  }
                  value={String(selected.intervalMinutes)}
                  onChange={(v) => void patch({ intervalMinutes: Number(v) })}
                  options={[15, 30, 60, 180, 360, 720, 1440].map((n) => ({ value: String(n), label: every(n, t) }))}
                />
                {selected.lastError && <ActionRow title={t('auto.failing')} subtitle={<span className="text-bad">{selected.lastError}</span>} />}
                {/*
                  Only an episode that gets all the way through clears this, and one
                  that has been given up on never will, so it can be put away by hand.
                */}
                {selected.lastRunError && (
                  <ActionRow
                    title={selected.lastRunFailedAt ? t('auto.runFailedAt', { when: ago(selected.lastRunFailedAt, t) }) : t('auto.runFailing')}
                    subtitle={<span className="text-bad">{selected.lastRunError}</span>}
                    suffix={
                      <IconButton
                        label={t('auto.dismissRunError')}
                        icon={<X size={16} />}
                        onClick={() => void patch({ lastRunError: undefined, lastRunFailedAt: undefined })}
                      />
                    }
                  />
                )}
              </PreferencesGroup>

              {/* ---- the chain ---- */}
              <PreferencesGroup
                title={t('auto.pipeline')}
                footer={
                  missing.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {missing.map((kind) => (
                        <button key={kind} type="button" className="btn-quiet" onClick={() => setEditing(kind)} data-uvd={`step-add-${kind}`}>
                          <Plus size={14} /> {t(STEP_LABEL[kind])}
                        </button>
                      ))}
                    </div>
                  ) : undefined
                }
              >
                <ActionRow title={t('auto.step.download')} prefix={STEP_ICON.download} value={t('auto.always')} />
                {/* In the order they run, which a watch saved before this need not be stored in. */}
                {selected.steps
                  .filter((s) => s.kind !== 'download')
                  .sort(byStepOrder)
                  .map((step) => (
                    <Fragment key={step.id}>
                      <ActionRow
                        title={t(STEP_LABEL[step.kind])}
                        prefix={STEP_ICON[step.kind]}
                        monoSubtitle={step.kind === 'rename'}
                        subtitle={
                          step.kind === 'rename'
                            ? step.template
                            : step.kind === 'upload'
                              ? `${step.remotePath} · ${t(step.deleteLocalAfter ? 'auto.localDeleted' : 'auto.localKept')}`
                              : step.kind === 'notify' && settings?.telegramChatId
                                ? t('auto.notifyTo', { id: settings.telegramChatId })
                                : undefined
                        }
                        value={step.enabled ? <Check size={16} className="text-good" /> : <X size={16} className="text-ink-2" />}
                        navigation
                        onActivate={() => setEditing(step)}
                      />
                      {/* On the screen, not only inside the editor: tucked away there, nobody found it. */}
                      {step.kind === 'upload' && (
                        <SwitchRow
                          className="pl-[39px]"
                          title={t('auto.deleteLocal')}
                          checked={step.deleteLocalAfter}
                          onChange={(v) => void saveStep({ ...step, deleteLocalAfter: v })}
                        />
                      )}
                    </Fragment>
                  ))}
              </PreferencesGroup>

              {/* ---- what has happened ---- */}
              <PreferencesGroup title={t('auto.history')}>
                {runs.length === 0 ? (
                  <ActionRow title={t('auto.noRuns')} />
                ) : (
                  runs.map((run) => (
                    <div key={run.id} className="ui-row flex-col items-stretch gap-1">
                      <div className="flex items-center gap-2">
                        <span className="numeric text-body text-ink">
                          S{String(run.season).padStart(2, '0')}E{String(run.episode).padStart(2, '0')}
                        </span>
                        <span className={`text-meta font-bold ${run.state === 'failed' ? 'text-bad' : run.state === 'done' ? 'text-good' : 'text-ink-2'}`}>
                          {t(RUN_LABEL[run.state])}
                        </span>
                        <span className="numeric ml-auto text-meta text-ink-2">{ago(run.startedAt, t)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {[...run.steps].sort(byStepOrder).map((st, i) => (
                          <span
                            key={i}
                            className={`text-meta ${st.state === 'failed' ? 'text-bad' : 'text-ink-2'}`}
                            title={st.message}
                          >
                            {t(STEP_LABEL[st.kind])}
                            {(st.state === 'failed' || (run.state === 'skipped' && st.state === 'skipped')) && st.message ? `: ${st.message}` : ''}
                          </span>
                        ))}
                      </div>
                      {run.state === 'running' && run.downloadId && <QueueLink id={run.downloadId} />}
                      {(run.state === 'failed' || run.state === 'skipped') && (
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-meta text-ink-2">
                            {run.state === 'failed' && attemptsAt(selected, run) > 0
                              ? t('auto.runWillRetry', { n: attemptsAt(selected, run), max: MAX_ATTEMPTS })
                              : ''}
                          </span>
                          <button type="button" className="btn-quiet" onClick={() => void retry(run)}>
                            <RotateCcw size={14} /> {t('auto.retryRun')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </PreferencesGroup>
            </m.div>
          )}

          {/* ---- Telegram: its own group (A1 §3), the same form as Settings › Watching › Telegram ---- */}
          <div className="space-y-3">
            <PreferencesGroup title={t('prefs.sub.telegram')} id="telegram" />
            <AutomationSettings part="telegram" />
          </div>
        </PreferencesPage>
      )}

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
