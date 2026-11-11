import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from '../ui/icons'
import { useT } from '../i18n'
import { useStore } from '../store'
import { toast } from '../lib/toast'
import { describeError } from '../lib/errors'
import { STEP_LABEL } from '../lib/automationLabels'
import { emptyTarget, pathOf, ShareForm, TelegramForm, useSecretState } from './AutomationForms'
import Dialog from '../ui/Dialog'
import Dropdown from '../ui/Dropdown'
import IconButton from '../ui/IconButton'
import { PreferencesGroup, SwitchRow } from '../ui'
import {
  DEFAULT_REMOTE_PATH,
  DEFAULT_RENAME_TEMPLATE,
  DEFAULT_VIDEO_REMOTE_PATH,
  DEFAULT_VIDEO_RENAME_TEMPLATE,
  remoteDirFor,
  renameFor,
  renameGap,
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

const blank = (kind: StepKind, video: boolean): PipelineStep => {
  const id = crypto.randomUUID()
  if (kind === 'rename') {
    return { id, kind, enabled: true, template: video ? DEFAULT_VIDEO_RENAME_TEMPLATE : DEFAULT_RENAME_TEMPLATE, replacements: [] }
  }
  if (kind === 'upload') {
    return {
      id,
      kind,
      enabled: true,
      targetId: '',
      remotePath: video ? DEFAULT_VIDEO_REMOTE_PATH : DEFAULT_REMOTE_PATH,
      createDirs: true,
      deleteLocalAfter: true
    }
  }
  return { id, kind: kind as 'notify' | 'download', enabled: true }
}

const SAMPLE = { season: 1, episode: 9, quality: '720p', ext: 'mkv' }
const SAMPLE_VIDEO = { videoId: 'dQw4w9WgXcQ', season: 0, episode: 0, quality: '720p', ext: 'mp4' }

export default function StepEditor({
  step: initial,
  video = false,
  onSave,
  onRemove,
  onClose
}: {
  step: PipelineStep | StepKind
  /** For a channel or playlist, whose uploads have titles and no numbers. */
  video?: boolean
  /** May be a save in progress: the dialog waits for it, and stays open with the reason if it fails. */
  onSave: (step: PipelineStep) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const targets = settings?.smbTargets ?? []
  const secrets = useSecretState()

  const isNew = typeof initial === 'string'
  const [step, setStep] = useState<PipelineStep>(() =>
    typeof initial === 'string' ? blank(initial, video) : { ...initial }
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
    // A password typed for one share is not the next one's: it was written to whichever was chosen at Save.
    setPassword('')
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
      // The names in the example are in the reader's language: it was a Russian title in the English interface.
      const sample = video
        ? { ...SAMPLE_VIDEO, title: t('auto.sampleVideo'), channel: t('auto.sampleChannel') }
        : { ...SAMPLE, title: t('auto.sampleSeries') }
      if (step.kind === 'rename') return renameFor(step, sample)
      if (step.kind === 'upload') return remoteDirFor(step.remotePath, sample) || '/'
    } catch {
      return ''
    }
    return ''
  }, [step, video, t])

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
        await onSave({ ...step, targetId: target.id })
        return
      }
      if (step.kind === 'notify') {
        await saveSettings({ telegramChatId: chatId.trim() })
        if (token.trim()) await window.api.autoSetSecret('telegram', '', token.trim())
        await onSave(step)
        return
      }
      await onSave(step)
    } catch (err) {
      toast(describeError(err), 'error')
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
    <Dialog
      variant="sheet"
      size="md"
      title={t(STEP_LABEL[step.kind])}
      closeLabel={t('common.close')}
      onClose={onClose}
      actions={
        <>
          {!isNew && (
            <button
              className="btn-danger mr-auto"
              disabled={saving}
              onClick={() => {
                setSaving(true)
                // The dialog closes when the step is gone; if it could not go, it says why and lets go.
                void Promise.resolve(onRemove(step.id)).catch((err: unknown) => {
                  toast(describeError(err), 'error')
                  setSaving(false)
                })
              }}
            >
              <Trash2 size={14} /> {t('common.remove')}
            </button>
          )}
          <button className="btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-solid" onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {step.kind === 'rename' && (
          <>
            <div>
              <p className="label mb-1.5">{t('auto.template')}</p>
              <input
                value={step.template}
                onChange={(e) => set({ template: e.target.value })}
                aria-label={t('auto.template')}
                className="field mono w-full text-control"
                spellCheck={false}
              />
              <p className="hint mt-1">{t(video ? 'auto.templateHintVideo' : 'auto.templateHint')}</p>
              {renameGap(step.template, video) === 'videoNumbers' && (
                <p className="mt-1 max-w-[62ch] text-meta leading-[1.5] text-warn">
                  {t('auto.templateVideoNumbers')}
                </p>
              )}
              {renameGap(step.template, video) === 'videoName' && (
                <p className="mt-1 max-w-[62ch] text-meta leading-[1.5] text-warn">
                  {t('auto.templateVideoName')}
                </p>
              )}
              {/*
                Said, not enforced. A missing episode is put right by the
                rename itself, and a missing season is harmless for a
                series with only one.
              */}
              {renameGap(step.template, video) === 'episode' && (
                <p className="mt-1 max-w-[62ch] text-meta leading-[1.5] text-warn">
                  {t('auto.templateNoEpisode')}
                </p>
              )}
              {renameGap(step.template, video) === 'season' && (
                <p className="mt-1 max-w-[62ch] text-meta leading-[1.5] text-warn">
                  {t('auto.templateNoSeason')}
                </p>
              )}
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
                    className="field flex-1 text-control"
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
                    className="field flex-1 text-control"
                  />
                  <IconButton
                    label={t('common.remove')}
                    icon={<Trash2 size={16} />}
                    onClick={() => set({ replacements: step.replacements.filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
              <button
                className="btn-quiet"
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
                <Dropdown
                  variant="field"
                  aria-label={t('auto.share')}
                  value={targetId}
                  onChange={setTargetId}
                  options={[...targets.map((x) => ({ value: x.id, label: x.name })), { value: NEW_SHARE, label: t('auto.shareNew') }]}
                />
              </div>
            )}

            <div>
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
                className="field mono w-full text-control"
                spellCheck={false}
              />
              <p className="hint mt-1">{t('auto.remotePathHint')}</p>
            </div>

            <PreferencesGroup>
              <SwitchRow
                id="deleteLocal"
                title={t('auto.deleteLocal')}
                checked={step.deleteLocalAfter}
                onChange={(on) => set({ deleteLocalAfter: on })}
              />
            </PreferencesGroup>
          </>
        )}

        {step.kind === 'notify' && (
          <>
            <p className="hint">{t('auto.notifyHint')}</p>
            <div>
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
            <p className="mono break-all text-meta text-ink-2">{preview}</p>
          </div>
        )}

        <PreferencesGroup>
          <SwitchRow
            id="stepEnabled"
            title={t('auto.stepEnabled')}
            checked={step.enabled}
            onChange={(on) => set({ enabled: on })}
          />
        </PreferencesGroup>
      </div>

    </Dialog>
  )
}
