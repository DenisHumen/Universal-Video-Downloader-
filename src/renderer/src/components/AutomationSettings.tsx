import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { toast } from '../lib/toast'
import { emptyTarget, ShareForm, TelegramForm, useSecretState } from './AutomationForms'
import type { SmbTarget } from '@shared/automation'

/**
 * The watching section of Settings.
 *
 * The same forms the step editor uses, on the same store. Somebody who goes
 * looking in Settings finds them; somebody who is halfway through building a
 * chain never has to leave it. Neither route is the "real" one, and because it
 * is one component over one source of truth there is nothing to keep in step.
 */
export default function AutomationSettings(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const secrets = useSecretState()
  const targets = settings?.smbTargets ?? []

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<SmbTarget>(emptyTarget)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  useEffect(() => setChatId(settings?.telegramChatId ?? ''), [settings?.telegramChatId])

  const startNew = (): void => {
    const fresh = emptyTarget()
    setDraft(fresh)
    setPassword('')
    setEditing(fresh.id)
  }

  const startEdit = (target: SmbTarget): void => {
    setDraft(target)
    setPassword('')
    setEditing(target.id)
  }

  const saveShare = async (): Promise<void> => {
    setSaving(true)
    try {
      const target: SmbTarget = {
        ...draft,
        name: draft.name.trim() || `${draft.host}/${draft.share}`
      }
      await saveSettings({ smbTargets: [...targets.filter((x) => x.id !== target.id), target] })
      if (password) await window.api.autoSetSecret('smb', target.id, password)
      secrets.refresh()
      setEditing(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  /*
    Removing a share does not touch the steps pointing at it. A watch whose
    share has gone says so when it next runs, which is a clearer thing to read
    than a step that quietly stopped uploading.
  */
  const removeShare = async (id: string): Promise<void> => {
    await saveSettings({ smbTargets: targets.filter((x) => x.id !== id) })
    await window.api.autoSetSecret('smb', id, '')
    secrets.refresh()
    if (editing === id) setEditing(null)
  }

  const saveTelegram = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings({ telegramChatId: chatId.trim() })
      if (token.trim()) await window.api.autoSetSecret('telegram', '', token.trim())
      setToken('')
      secrets.refresh()
      toast(t('common.save'), 'success')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {!secrets.persists && <p className="hint mb-3 text-bad">{t('settings.secretsVolatile')}</p>}

      <div className="border-b border-edge py-4">
        <p className="text-[14px] text-ink">{t('settings.shares')}</p>
        <p className="hint mt-1">{t('settings.sharesHint')}</p>

        <div className="mt-3 space-y-1.5">
          {targets.length === 0 && <p className="hint">{t('settings.noShares')}</p>}
          {targets.map((target) => (
            <div key={target.id}>
              <div className="flex items-center gap-2">
                <button
                  className="panel flex-1 px-3 py-2 text-left transition-colors hover:bg-raise"
                  onClick={() => (editing === target.id ? setEditing(null) : startEdit(target))}
                >
                  <span className="block text-[13px] text-ink">{target.name}</span>
                  <span className="mono block text-[11px] text-ink-2">
                    {target.host}/{target.share}
                    {secrets.smb[target.id] ? '' : ` · ${t('auto.sharePassword')}?`}
                  </span>
                </button>
                <button
                  className="btn-icon"
                  aria-label={t('common.remove')}
                  onClick={() => void removeShare(target.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {editing === target.id && (
                <div className="mt-2 space-y-3 rounded border border-edge p-3">
                  <ShareForm
                    target={draft}
                    onTarget={setDraft}
                    password={password}
                    onPassword={setPassword}
                    passwordStored={Boolean(secrets.smb[target.id])}
                  />
                  <div className="flex justify-end gap-2">
                    <button className="btn" onClick={() => setEditing(null)}>
                      {t('common.cancel')}
                    </button>
                    <button className="btn-solid" onClick={() => void saveShare()} disabled={saving}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {editing !== null && !targets.some((x) => x.id === editing) && (
            <div className="space-y-3 rounded border border-edge p-3">
              <ShareForm
                target={draft}
                onTarget={setDraft}
                password={password}
                onPassword={setPassword}
                passwordStored={false}
              />
              <div className="flex justify-end gap-2">
                <button className="btn" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </button>
                <button className="btn-solid" onClick={() => void saveShare()} disabled={saving}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}

          {editing === null && (
            <button className="btn" onClick={startNew}>
              <Plus size={14} /> {t('settings.addShare')}
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-edge py-4">
        <p className="text-[14px] text-ink">{t('settings.telegram')}</p>
        <p className="hint mb-3 mt-1">{t('settings.telegramHint')}</p>
        <TelegramForm
          token={token}
          onToken={setToken}
          chatId={chatId}
          onChatId={setChatId}
          tokenStored={secrets.telegram}
        />
        <div className="mt-3 flex justify-end">
          <button className="btn-solid" onClick={() => void saveTelegram()} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('common.save')}
          </button>
        </div>
      </div>
    </>
  )
}
