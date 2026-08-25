import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useT } from '../i18n'
import { toast } from '../lib/toast'
import type { SmbTarget } from '@shared/automation'

/**
 * The two things the automation needs credentials for.
 *
 * One implementation each, used both from the step that needs them and from
 * Settings, because people go looking in different places and neither is wrong.
 * Sharing the component is what makes the two agree: they read the same store
 * and write the same secrets, so there is no synchronising to get wrong — a
 * change made in one is already the state of the other.
 *
 * Both are controlled. Saving belongs to whoever owns the surrounding dialog or
 * page, which is what lets the same form be a section of Settings in one place
 * and part of a step's setup in another.
 */

export const emptyTarget = (): SmbTarget => ({
  id: crypto.randomUUID(),
  name: '',
  host: '',
  share: '',
  domain: '',
  username: ''
})

/**
 * Which secrets are already stored.
 *
 * The renderer is never told a value — only whether it needs to ask. That is
 * the difference between an empty box meaning "type it again" and one meaning
 * "leave this alone", and it is the whole reason the password field can be
 * blank without destroying what is saved.
 */
export function useSecretState(): {
  telegram: boolean
  smb: Record<string, boolean>
  persists: boolean
  refresh: () => void
} {
  const [state, setState] = useState({
    telegram: false,
    smb: {} as Record<string, boolean>,
    persists: true
  })
  const refresh = useCallback(() => {
    void window.api.autoSecretState().then(setState)
  }, [])
  useEffect(refresh, [refresh])
  return { ...state, refresh }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  hint?: string
}): JSX.Element {
  return (
    <div>
      <p className="label mb-1.5">{label}</p>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field mono w-full text-[13px]"
        spellCheck={false}
      />
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  )
}

export function ShareForm({
  target,
  onTarget,
  password,
  onPassword,
  passwordStored
}: {
  target: SmbTarget
  onTarget: (t: SmbTarget) => void
  password: string
  onPassword: (p: string) => void
  passwordStored: boolean
}): JSX.Element {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const ready = Boolean(target.host && target.share && target.username)

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      toast(await window.api.autoTestSmb(target, password), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label={t('auto.shareHost')}
        value={target.host}
        onChange={(v) => onTarget({ ...target, host: v })}
        placeholder="192.168.1.10"
        hint={t('auto.shareHostHint')}
      />
      <Field
        label={t('auto.shareName2')}
        value={target.share}
        onChange={(v) => onTarget({ ...target, share: v })}
        placeholder="shared"
        hint={t('auto.shareNameHint')}
      />
      <Field
        label={t('auto.shareUser')}
        value={target.username}
        onChange={(v) => onTarget({ ...target, username: v })}
      />
      <Field
        label={t('auto.sharePassword')}
        type="password"
        value={password}
        onChange={onPassword}
        placeholder={passwordStored ? t('auto.secretKept') : ''}
        hint={t('auto.secretHint')}
      />
      <Field
        label={t('auto.shareLabel')}
        value={target.name}
        onChange={(v) => onTarget({ ...target, name: v })}
        placeholder={target.host ? `${target.host}/${target.share}` : ''}
        hint={t('auto.shareLabelHint')}
      />
      <button className="btn" onClick={() => void test()} disabled={testing || !ready}>
        {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {t('auto.testConnection')}
      </button>
    </div>
  )
}

export function TelegramForm({
  token,
  onToken,
  chatId,
  onChatId,
  tokenStored
}: {
  token: string
  onToken: (v: string) => void
  chatId: string
  onChatId: (v: string) => void
  tokenStored: boolean
}): JSX.Element {
  const t = useT()
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      toast(await window.api.autoTestTelegram(token, chatId), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label={t('auto.botToken')}
        type="password"
        value={token}
        onChange={onToken}
        placeholder={tokenStored ? t('auto.secretKept') : '123456789:AA...'}
        hint={t('auto.botTokenHint')}
      />
      <Field
        label={t('auto.chatId')}
        value={chatId}
        onChange={onChatId}
        placeholder="100000000"
        hint={t('auto.chatIdHint')}
      />
      <button
        className="btn"
        onClick={() => void test()}
        disabled={testing || !chatId.trim() || (!tokenStored && !token.trim())}
      >
        {testing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {t('auto.testMessage')}
      </button>
    </div>
  )
}
