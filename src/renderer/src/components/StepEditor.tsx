import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { dialog, overlay } from '../lib/motion'
import { useT } from '../i18n'
import { useStore } from '../store'
import { toast } from '../lib/toast'
import { STEP_LABEL } from '../lib/automationLabels'
import { emptyTarget, pathOf, ShareForm, TelegramForm, useSecretState } from './AutomationForms'
import {
  DEFAULT_REMOTE_PATH,
  remoteDirFor,
  renameFor,
  type PipelineStep,
  type SmbTarget,
  type StepKind
} from '@shared/automation'

/**
 * Setting up one step of a chain.
 *
 * Everything a step needs is here, including the parts that are technically
 * settings. The first version pointed at Settings to add a share — and there
 * was nothing there to add one with, so the dialog's own advice was a dead end.
 * Even once that existed, being told mid-task to go elsewhere, configure
 * something, and find your way back is a poor trade for the tidiness it buys.
 *
 * The same forms appear in Settings, because people go looking in different
 * places and neither is wrong. They are the same component reading the same
 * store, so the two cannot drift apart.
 *
 * The rename and remote-path fields show what they will actually produce
 * against a made-up episode, as the user types: a filename template is exactly
 * the kind of thing nobody gets right first time and nobody wants to test by
 * waiting six hours for an episode.
 */

const NEW_SHARE = '__new__'

const blank = (kind: StepKind): PipelineStep => {
  const id = crypto.randomUUID()
  if (kind === 'rename') {
    return { id, kind, enabled: true, template: '{title} - S{season2}E{episode2}', replacements: [] }
  }
  if (kind === 'upload') {
    return {
      id,
      kind,
      enabled: true,
      targetId: '',
      remotePath: DEFAULT_REMOTE_PATH,
      createDirs: true,
      deleteLocalAfter: false
    }
  }
  return { id, kind: kind as 'notify' | 'download', enabled: true }
}

const SAMPLE = { title: 'Табакошка', season: 1, episode: 9, quality: '720p', ext: 'mkv' }

export default function StepEditor({
  step: initial,
  onSave,
  onRemove,
  onClose
}: {
  step: PipelineStep | StepKind
  onSave: (step: PipelineStep) => void
  onRemove: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const targets = settings?.smbTargets ?? []
  const secrets = useSecretState()

  const isNew = typeof initial === 'string'
  const [step, setStep] = useState<PipelineStep>(() =>
    typeof initial === 'string' ? blank(initial) : { ...initial }
  )

  const firstTarget =
    step.kind === 'upload' && step.targetId ? step.targetId : (targets[0]?.id ?? NEW_SHARE)
  const [targetId, setTargetId] = useState(firstTarget)
  const [draft, setDraft] = useState<SmbTarget>(
    () => targets.find((x) => x.id === firstTarget) ?? emptyTarget()
  )
  const [password, setPassword] = useState('')

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(settings?.telegramChatId ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (targetId === NEW_SHARE) {
      setDraft(emptyTarget())
      return
    }
    const found = targets.find((x) => x.id === targetId)
    if (found) setDraft(found)
    // Keyed on the id: `targets` is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  const preview = useMemo(() => {
    try {
      if (step.kind === 'rename') return renameFor(step, SAMPLE)
      if (step.kind === 'upload') return remoteDirFor(step.remotePath, SAMPLE) || '/'
    } catch {
      return ''
    }
    return ''
  }, [step])

  const set = (patch: Partial<PipelineStep>): void =>
    setStep((s) => ({ ...s, ...patch }) as PipelineStep)

  /**
   * Save the step, and whatever it needed set up along with it.
   *
   * The settings write happens first. A step pointing at a share that was never
   * stored is a step that fails at four in the morning with "the share this
   * watch uploads to is no longer configured".
   */
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (step.kind === 'upload') {
        const target: SmbTarget = {
          ...draft,
          name: draft.name.trim() || pathOf(draft)
        }
        await saveSettings({ smbTargets: [...targets.filter((x) => x.id !== target.id), target] })
        if (password) await window.api.autoSetSecret('smb', target.id, password)
        onSave({ ...step, targetId: target.id })
        return
      }
      if (step.kind === 'notify') {
        await saveSettings({ telegramChatId: chatId.trim() })
        if (token.trim()) await window.api.autoSetSecret('telegram', '', token.trim())
        onSave(step)
        return
      }
      onSave(step)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      setSaving(false)
    }
  }

  const canSave =
    step.kind === 'upload'
      ? Boolean(draft.host && draft.share && draft.username) &&
        (secrets.smb[targetId] || Boolean(password))
      : step.kind === 'notify'
        ? Boolean(chatId.trim()) && (secrets.telegram || Boolean(token.trim()))
        : true

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
          className="panel flex max-h-full w-full max-w-lg flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
            <h2 className="h2 flex-1">{t(STEP_LABEL[step.kind])}</h2>
            <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {step.kind === 'rename' && (
              <>
                <div>
                  <p className="label mb-1.5">{t('auto.template')}</p>
                  <input
                    value={step.template}
                    onChange={(e) => set({ template: e.target.value })}
                    aria-label={t('auto.template')}
                    className="field mono w-full text-[13px]"
                    spellCheck={false}
                  />
                  <p className="hint mt-1">{t('auto.templateHint')}</p>
                </div>
                <div>
                  <p className="label mb-1.5">{t('auto.replacements')}</p>
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
                    onClick={() =>
                      set({ replacements: [...step.replacements, { from: '', to: '' }] })
                    }
                  >
                    <Plus size={14} /> {t('auto.addReplacement')}
                  </button>
                </div>
              </>
            )}

            {step.kind === 'upload' && (
              <>
                {targets.length > 0 && (
                  <div>
                    <p className="label mb-1.5">{t('auto.share')}</p>
                    <select
                      className="field w-full text-[13px]"
                      aria-label={t('auto.share')}
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                    >
                      {targets.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                      <option value={NEW_SHARE}>{t('auto.shareNew')}</option>
                    </select>
                  </div>
                )}

                <div className="rounded border border-edge p-3">
                  <ShareForm
                    target={draft}
                    onTarget={setDraft}
                    password={password}
                    onPassword={setPassword}
                    passwordStored={Boolean(secrets.smb[targetId])}
                  />
                </div>

                <div>
                  <p className="label mb-1.5">{t('auto.remotePath')}</p>
                  <input
                    value={step.remotePath}
                    onChange={(e) => set({ remotePath: e.target.value })}
                    aria-label={t('auto.remotePath')}
                    className="field mono w-full text-[13px]"
                    spellCheck={false}
                  />
                  <p className="hint mt-1">{t('auto.remotePathHint')}</p>
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

            {step.kind === 'notify' && (
              <>
                <p className="hint">{t('auto.notifyHint')}</p>
                <div className="rounded border border-edge p-3">
                  <TelegramForm
                    token={token}
                    onToken={setToken}
                    chatId={chatId}
                    onChatId={setChatId}
                    tokenStored={secrets.telegram}
                  />
                </div>
              </>
            )}

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

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
            {!isNew && (
              <button className="btn-danger mr-auto" onClick={() => onRemove(step.id)}>
                <Trash2 size={14} /> {t('common.remove')}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn-solid" onClick={() => void save()} disabled={!canSave || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('common.save')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
