import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, X } from 'lucide-react'
import { dialog, overlay } from '../lib/motion'
import { useT } from '../i18n'
import { STEP_LABEL } from '../lib/automationLabels'
import { renameFor, remoteDirFor, type PipelineStep, type SmbTarget, type StepKind } from '@shared/automation'

/**
 * Setting up one step of a chain.
 *
 * The rename and remote-path fields show what they will actually produce,
 * against a made-up episode, as the user types. A filename template is exactly
 * the kind of thing nobody gets right first time and nobody wants to test by
 * waiting six hours for an episode.
 */

const blank = (kind: StepKind): PipelineStep => {
  const id = crypto.randomUUID()
  if (kind === 'rename') {
    return {
      id,
      kind,
      enabled: true,
      template: '{title} - S{season2}E{episode2}',
      replacements: []
    }
  }
  if (kind === 'upload') {
    return {
      id,
      kind,
      enabled: true,
      targetId: '',
      remotePath: '{title}/season {season}',
      createDirs: true,
      deleteLocalAfter: false
    }
  }
  return { id, kind: kind as 'notify' | 'download', enabled: true }
}

const SAMPLE = { title: 'Табакошка', season: 1, episode: 9, quality: '720p', ext: 'mkv' }

export default function StepEditor({
  step: initial,
  targets,
  onSave,
  onRemove,
  onClose
}: {
  step: PipelineStep | StepKind
  targets: SmbTarget[]
  onSave: (step: PipelineStep) => void
  onRemove: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const isNew = typeof initial === 'string'
  const [step, setStep] = useState<PipelineStep>(() =>
    typeof initial === 'string' ? blank(initial) : { ...initial }
  )

  const preview = useMemo(() => {
    try {
      if (step.kind === 'rename') return renameFor(step, SAMPLE)
      if (step.kind === 'upload') {
        return remoteDirFor(step.remotePath, SAMPLE) || '(root of the share)'
      }
    } catch {
      return ''
    }
    return ''
  }, [step])

  const set = (patch: Partial<PipelineStep>): void =>
    setStep((s) => ({ ...s, ...patch }) as PipelineStep)

  return (
    <AnimatePresence>
      <motion.div
        {...overlay}
        className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
        style={{ zIndex: 'var(--z-modal)' }}
        onClick={onClose}
      >
        <motion.div
          {...dialog}
          role="dialog"
          aria-modal="true"
          className="panel w-full max-w-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
            <h2 className="h2 flex-1">{t(STEP_LABEL[step.kind])}</h2>
            <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
              <X size={15} />
            </button>
          </div>

          <div className="space-y-4 p-4">
            {step.kind === 'rename' && (
              <>
                <div>
                  <p className="label mb-2">{t('auto.template')}</p>
                  <input
                    value={step.template}
                    onChange={(e) => set({ template: e.target.value })}
                    aria-label={t('auto.template')}
                    className="field mono w-full text-[13px]"
                    spellCheck={false}
                  />
                  <p className="hint mt-1.5">{t('auto.templateHint')}</p>
                </div>

                <div>
                  <p className="label mb-2">{t('auto.replacements')}</p>
                  <p className="hint mb-2">{t('auto.replacementsHint')}</p>
                  {step.replacements.map((r, i) => (
                    <div key={i} className="mb-1.5 flex gap-2">
                      <input
                        value={r.from}
                        onChange={(e) => {
                          const next = [...step.replacements]
                          next[i] = { ...r, from: e.target.value }
                          set({ replacements: next })
                        }}
                        placeholder={t('auto.replaceFrom')}
                        aria-label={t('auto.replaceFrom')}
                        className="field flex-1 text-[13px]"
                      />
                      <input
                        value={r.to}
                        onChange={(e) => {
                          const next = [...step.replacements]
                          next[i] = { ...r, to: e.target.value }
                          set({ replacements: next })
                        }}
                        placeholder={t('auto.replaceTo')}
                        aria-label={t('auto.replaceTo')}
                        className="field flex-1 text-[13px]"
                      />
                      <button
                        className="btn-icon"
                        aria-label={t('common.remove')}
                        onClick={() =>
                          set({ replacements: step.replacements.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn"
                    onClick={() => set({ replacements: [...step.replacements, { from: '', to: '' }] })}
                  >
                    <Plus size={14} /> {t('auto.addReplacement')}
                  </button>
                </div>
              </>
            )}

            {step.kind === 'upload' && (
              <>
                <div>
                  <p className="label mb-2">{t('auto.share')}</p>
                  {targets.length === 0 ? (
                    <p className="hint text-bad">{t('auto.noShares')}</p>
                  ) : (
                    <select
                      className="field w-full text-[13px]"
                      aria-label={t('auto.share')}
                      value={step.targetId}
                      onChange={(e) => set({ targetId: e.target.value })}
                    >
                      <option value="">{t('auto.pickShare')}</option>
                      {targets.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} — {x.host}/{x.share}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <p className="label mb-2">{t('auto.remotePath')}</p>
                  <input
                    value={step.remotePath}
                    onChange={(e) => set({ remotePath: e.target.value })}
                    aria-label={t('auto.remotePath')}
                    className="field mono w-full text-[13px]"
                    spellCheck={false}
                  />
                  <p className="hint mt-1.5">{t('auto.remotePathHint')}</p>
                </div>

                <label className="flex items-center gap-2.5 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={step.deleteLocalAfter}
                    onChange={(e) => set({ deleteLocalAfter: e.target.checked })}
                  />
                  {t('auto.deleteLocal')}
                </label>
              </>
            )}

            {step.kind === 'notify' && <p className="hint">{t('auto.notifyHint')}</p>}

            {preview && (
              <div className="border-t border-edge pt-3">
                <p className="label mb-1">{t('auto.preview')}</p>
                <p className="mono break-all text-[12px] text-ink-2">{preview}</p>
              </div>
            )}

            <label className="flex items-center gap-2.5 border-t border-edge pt-3 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              {t('auto.stepEnabled')}
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
            {!isNew && (
              <button className="btn-danger mr-auto" onClick={() => onRemove(step.id)}>
                <Trash2 size={14} /> {t('common.remove')}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              className="btn-solid"
              onClick={() => onSave(step)}
              disabled={step.kind === 'upload' && !step.targetId}
            >
              {t('common.save')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
