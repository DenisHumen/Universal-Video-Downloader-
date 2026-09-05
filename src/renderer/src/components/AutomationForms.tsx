import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useT } from '../i18n'
import { toast } from '../lib/toast'
import { describeError } from '../lib/errors'
import {
  formatSmbPath,
  normaliseSmbTarget,
  parseSmbPath,
  type SmbTarget
} from '@shared/automation'

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

/** What a location looks like, so the box explains its own format. */
const PLACEHOLDER = '\\\\192.168.1.10\\shared\\video\\series'

export const emptyTarget = (): SmbTarget => ({
  id: crypto.randomUUID(),
  name: '',
  host: '',
  share: '',
  path: '',
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

/**
 * The three parts of a location, as one string in the form people write it.
 *
 * Repairs as it formats, so a share saved by an older version reads correctly
 * everywhere it is shown - in the list, in the box, and in the name it suggests
 * - rather than only once its settings have been written again.
 */
export const pathOf = (target: SmbTarget): string => {
  const { host, share, path } = normaliseSmbTarget(target)
  return formatSmbPath({ host, share, folder: path })
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

  /*
    One box for the whole path.

    The first version asked for the server and the share separately, and got a
    whole path typed into the share box - which the server rejects outright,
    because a share name is only ever the first segment. That was the form's
    fault, not the typist's: nobody holds a network location in their head as
    three fields. They hold the one line they would paste into an address bar.

    So take that line and do the splitting here. The text is kept as typed
    rather than reformatted on every keystroke, because a field that rewrites
    itself under the cursor is impossible to edit; what the app made of it is
    shown underneath instead, so the split is visible rather than magic.
  */
  const [text, setText] = useState(() => pathOf(target))
  useEffect(() => {
    /*
      A share saved before this box existed holds the whole path in its share
      field, and would be read back as a share named 'shared/torrents/downloads'
      sitting at the root. Repair it on the way in, so the readout below is the
      truth immediately rather than after the next restart.
    */
    const repaired = normaliseSmbTarget(target)
    if (repaired.share !== target.share || repaired.path !== (target.path ?? '')) {
      onTarget(repaired)
    }
    setText(pathOf(repaired))
    // Keyed on the id: this resyncs when the parent swaps which share is open,
    // not when the user is midway through typing into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id])

  const setPath = (value: string): void => {
    setText(value)
    const location = parseSmbPath(value)
    onTarget({
      ...target,
      host: location.host,
      share: location.share,
      path: location.folder
    })
  }

  const ready = Boolean(target.host && target.share && target.username)

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      toast(await window.api.autoTestSmb(target, password), 'success')
    } catch (err) {
      toast(describeError(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label={t('auto.sharePath')}
        value={text}
        onChange={setPath}
        placeholder={PLACEHOLDER}
        hint={t('auto.sharePathHint')}
      />

      {(target.host || target.share) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-ink-2">{t('auto.shareHost')}</dt>
          <dd className="mono truncate text-ink">{target.host || '—'}</dd>
          <dt className="text-ink-2">{t('auto.shareName2')}</dt>
          <dd className="mono truncate text-ink">{target.share || '—'}</dd>
          <dt className="text-ink-2">{t('auto.shareFolder')}</dt>
          <dd className="mono truncate text-ink">{target.path || t('auto.shareRoot')}</dd>
        </dl>
      )}

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
        placeholder={pathOf(target)}
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
      toast(describeError(err), 'error')
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
