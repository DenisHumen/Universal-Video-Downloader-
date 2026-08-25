import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  Clock,
  Film,
  FolderUp,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X
} from 'lucide-react'
import { enter } from '../lib/motion'
import { useStore } from '../store'
import { useT } from '../i18n'
import { toast } from '../lib/toast'
import Thumbnail from '../components/Thumbnail'
import ConfirmDialog from '../components/ConfirmDialog'
import AddWatchDialog from '../components/AddWatchDialog'
import StepEditor from '../components/StepEditor'
import { RUN_LABEL, STEP_LABEL } from '../lib/automationLabels'
import type { PipelineStep, Run, StepKind, Watch } from '@shared/automation'

/**
 * Watching series, and what happens when one produces an episode.
 *
 * Two panes: the list on the left, the selected series on the right. The same
 * arrangement a desktop chat app uses, for the same reason — many small things
 * of which one is open at a time — so it needs no explaining.
 */

const STEP_ICON: Record<StepKind, JSX.Element> = {
  download: <FolderUp size={15} />,
  rename: <Pencil size={15} />,
  upload: <FolderUp size={15} />,
  notify: <Send size={15} />
}

/** Steps a watch can gain, in the order they would run. */
const ADDABLE: StepKind[] = ['rename', 'upload', 'notify']

function relative(at: number | undefined, words: { soon: string; ahead: string; past: string }): string {
  if (!at) return ''
  const delta = at - Date.now()
  const mins = Math.round(Math.abs(delta) / 60_000)
  if (mins < 1) return words.soon
  const text = mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`
  return delta > 0 ? `${words.ahead} ${text}` : `${text} ${words.past}`
}

export default function AutomationView(): JSX.Element {
  const t = useT()
  const [watches, setWatches] = useState<Watch[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PipelineStep | StepKind | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [checking, setChecking] = useState(false)
  const settings = useStore((s) => s.settings)
  const words = {
    soon: t('auto.soon'),
    ahead: t('auto.in'),
    past: t('auto.ago')
  }

  const selected = useMemo(
    () => watches.find((w) => w.id === selectedId) ?? null,
    [watches, selectedId]
  )

  const refresh = useCallback(async (): Promise<void> => {
    const list = await window.api.autoList()
    setWatches(list)
    setSelectedId((current) => current ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    return window.api.onAutomationChanged(() => void refresh())
  }, [refresh])

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
    setChecking(true)
    try {
      await window.api.autoCheckNow(selected.id)
      await refresh()
      const after = await window.api.autoList()
      const w = after.find((x) => x.id === selected.id)
      toast(w?.lastError ? w.lastError : t('auto.checked'), w?.lastError ? 'error' : 'success')
    } finally {
      setChecking(false)
    }
  }

  const saveStep = async (step: PipelineStep): Promise<void> => {
    if (!selected) return
    const exists = selected.steps.some((s) => s.id === step.id)
    const steps = exists
      ? selected.steps.map((s) => (s.id === step.id ? step : s))
      : [...selected.steps, step]
    await patch({ steps })
    setEditing(null)
  }

  const removeStep = async (id: string): Promise<void> => {
    if (!selected) return
    await patch({ steps: selected.steps.filter((s) => s.id !== id) })
    setEditing(null)
  }

  const missing = ADDABLE.filter((k) => !selected?.steps.some((s) => s.kind === k))

  return (
    <div className="flex h-full min-h-0">
      {/* ---- the list ---- */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-edge">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
          <h1 className="label flex-1">{t('auto.title')}</h1>
          <button className="btn-solid px-2.5 py-1.5" onClick={() => setAdding(true)}>
            <Plus size={14} /> {t('auto.add')}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {watches.length === 0 ? (
            <p className="hint px-3 py-6 text-center">{t('auto.empty')}</p>
          ) : (
            watches.map((w) => (
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
                  <span className="block truncate text-[13px] text-ink">{w.title}</span>
                  <span className="mono block truncate text-[11px] text-ink-2">
                    {w.enabled
                      ? w.lastError
                        ? t('auto.failing')
                        : relative(w.nextCheckAt, words)
                      : t('auto.paused')}
                  </span>
                </span>
                {!w.enabled && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />}
                {w.enabled && w.lastError && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ---- the selected series ---- */}
      <motion.section
        key={selectedId ?? 'none'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={enter}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {!selected ? (
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
                <h2 className="h2 truncate">{selected.title}</h2>
                <p className="hint mt-1 truncate">
                  {[selected.translatorName, selected.quality].filter(Boolean).join(' · ')}
                </p>
                <p className="mono mt-1 text-[12px] text-ink-2">
                  <Clock size={11} className="mr-1 inline" />
                  {selected.enabled
                    ? `${t('auto.nextCheck')} ${relative(selected.nextCheckAt, words)}`
                    : t('auto.paused')}
                  {' · '}
                  {t('auto.everyN', { n: String(selected.intervalMinutes) })}
                </p>
                {selected.lastError && (
                  <p className="hint mt-1 text-bad">{selected.lastError}</p>
                )}
              </div>
            </header>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn" onClick={() => void patch({ enabled: !selected.enabled })}>
                {selected.enabled ? t('auto.pause') : t('auto.resume')}
              </button>
              <button className="btn" onClick={() => void checkNow()} disabled={checking}>
                {checking ? (
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
                    {t('auto.everyN', { n: String(n) })}
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

              {selected.steps
                .filter((s) => s.kind !== 'download')
                .map((step) => (
                  <button
                    key={step.id}
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
                        {step.kind === 'upload' && step.remotePath}
                      </span>
                    </span>
                    {step.enabled ? (
                      <Check size={14} className="text-good" />
                    ) : (
                      <X size={14} className="text-ink-3" />
                    )}
                  </button>
                ))}

              {missing.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {missing.map((kind) => (
                    <button key={kind} className="btn" onClick={() => setEditing(kind)}>
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
                        {relative(run.startedAt, words)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {run.steps.map((s, i) => (
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
                          {s.state === 'failed' && s.message ? `: ${s.message}` : ''}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </motion.section>

      {adding && (
        <AddWatchDialog
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
