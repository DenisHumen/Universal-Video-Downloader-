import { useEffect, useId, useRef, useState } from 'react'
import { isSafeTemplate } from '@shared/filename'
import { normaliseRate } from '@shared/rate'
import { isProxyValue, proxyUser } from '@shared/proxy'
import { useT } from '../../i18n'
import { EntryRow, useRowTitleId } from '../../ui'
import { templateExample, type TemplateExampleOptions } from '../../lib/templateExample'
import { useSecretState } from '../../components/AutomationForms'

/*
  The settings fields that can refuse a value, carried over from the 4.0
  SettingsView with their behaviour intact (see the notes on each), now as
  libadwaita rows.
*/

/** How long after the last key a typed setting is saved. A blur saves at once. */
const SAVE_AFTER_MS = 400

/**
 * A text setting as it is being typed.
 *
 * The field used to be bound straight to the saved value, and every key was a
 * save: over IPC and onto the disk, with the reply landing a moment later. Until
 * it did the field showed the old value, so the caret jumped to the end and a
 * quick typist lost letters; and a reply to an earlier key arrived over a later
 * one and put the text back. Now what is typed stays in the field, is saved
 * once the typing stops (or the field is left), and the saved value is only
 * followed while nobody is typing.
 */
export function useDraft(
  value: string,
  commit: (v: string) => void,
  accepts: (v: string) => boolean = () => true
): { draft: string; change: (v: string) => void; settle: () => void } {
  const [draft, setDraft] = useState(value)
  const typed = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const live = useRef({ commit, accepts, value })
  live.current = { commit, accepts, value }

  const save = (): void => {
    clearTimeout(timer.current)
    const text = typed.current
    typed.current = null
    if (text === null) return
    if (live.current.accepts(text)) {
      if (text !== live.current.value) live.current.commit(text)
    } else setDraft(live.current.value)
  }
  useEffect(() => {
    if (typed.current === null) setDraft(value)
  }, [value])
  // Leaving the page with something typed still saves it.
  useEffect(() => () => save(), [])

  return {
    draft,
    change: (v) => {
      typed.current = v
      setDraft(v)
      clearTimeout(timer.current)
      // Not while it would be refused: half a path or half a number is not a value yet.
      if (live.current.accepts(v)) timer.current = setTimeout(save, SAVE_AFTER_MS)
    },
    settle: save
  }
}

/** An entry row for a plain text setting, saved as `useDraft` describes. */
export function DraftEntryRow({
  value,
  onCommit,
  ...row
}: Omit<Parameters<typeof EntryRow>[0], 'value' | 'onChange' | 'onBlur'> & {
  value: string
  onCommit: (v: string) => void
}): JSX.Element {
  const { draft, change, settle } = useDraft(value, onCommit)
  return <EntryRow {...row} value={draft} onChange={(e) => change(e.target.value)} onBlur={settle} />
}

/**
 * The speed limit, which the engine reads far more strictly than people
 * write ("2MB", "1,5M", "2 Мб" all fail it). The draft is read into the
 * engine's form and committed only once it is one; until then the stored
 * limit stands and the row says what is expected.
 */
export function SpeedLimitField({ value, onCommit }: { value: string; onCommit: (v: string) => void }): JSX.Element {
  const t = useT()
  const labelledBy = useRowTitleId()
  const hintId = useId()
  // Saved in the engine's form; the field keeps what was typed until it is left (a Cyrillic "2М" would turn Latin mid-word).
  const { draft, change, settle } = useDraft(
    value,
    (text) => onCommit(normaliseRate(text) ?? value),
    (text) => normaliseRate(text) !== null
  )
  const valid = normaliseRate(draft) !== null
  return (
    <span className="flex flex-col items-end gap-1">
      <input
        value={draft}
        onChange={(e) => change(e.target.value)}
        onBlur={settle}
        placeholder="2M"
        aria-labelledby={labelledBy}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : hintId}
        className="ui-field numeric w-28 text-right font-mono"
        spellCheck={false}
      />
      {!valid && (
        <span id={hintId} className="max-w-[16rem] text-right text-meta text-bad">
          {t('settings.speedLimitInvalid')}
        </span>
      )}
    </span>
  )
}

/**
 * The filename template: a draft committed only when it is safe (typing the
 * first character of an absolute path used to wipe the field mid-word), a
 * line saying why when it is not, and the names it would give, so a template
 * can be got right without downloading something.
 */
export function TemplateRow({
  value,
  onCommit,
  example: options
}: {
  value: string
  onCommit: (v: string) => void
  example: TemplateExampleOptions
}): JSX.Element {
  const t = useT()
  const { draft, change, settle } = useDraft(value, onCommit, isSafeTemplate)
  const safe = isSafeTemplate(draft)
  const example = safe ? templateExample(draft, options) : null
  return (
    <>
      <EntryRow
        id="template"
        title={t('settings.filenameTemplate')}
        mono
        value={draft}
        invalid={!safe}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onBlur={settle}
      />
      <div className="ui-row flex-col items-stretch gap-1.5" role="status">
        {!safe && <p className="text-meta text-bad">{t('settings.filenameTemplateUnsafe')}</p>}
        {example && (
          <dl className="space-y-1">
            <div>
              <dt className="text-meta text-ink-2">{t('settings.templateExample')}</dt>
              <dd className="selectable font-mono text-meta text-ink [overflow-wrap:anywhere]">{example.video}</dd>
            </div>
            {example.playlist && (
              <div>
                <dt className="text-meta text-ink-2">{t('settings.templateExamplePlaylist')}</dt>
                <dd className="selectable font-mono text-meta text-ink [overflow-wrap:anywhere]">{example.playlist}</dd>
              </div>
            )}
          </dl>
        )}
        {example && <p className="text-meta text-ink-2">{t('settings.templateResolvedHint')}</p>}
      </div>
    </>
  )
}

/**
 * The proxy subpage's rows, like GNOME Network › Proxy. The address is
 * saved when the user is done with it (on blur, Enter, or leaving the page),
 * never per keystroke: saving reconfigures the app's own network, and every
 * prefix of an address on the way to it is a host that does not exist. A
 * password typed into the address moves to the secret store; the password
 * row never shows what is stored, and opens only once the address names a
 * user.
 */
export function ProxyRows({ value, onCommit }: { value: string; onCommit: (v: string) => Promise<void> }): JSX.Element {
  const t = useT()
  const secrets = useSecretState()
  const [draft, setDraft] = useState(value)
  const [pw, setPw] = useState('')
  /** The last password typed could not be sealed: it lasts until the app closes. */
  const [sessionOnly, setSessionOnly] = useState(false)
  useEffect(() => setDraft(value), [value])
  const refreshSecrets = secrets.refresh
  useEffect(() => refreshSecrets(), [value, refreshSecrets])
  const valid = isProxyValue(draft)
  const hasUser = Boolean(proxyUser(valid ? draft : value))

  const commit = (text: string): void => {
    const next = text.trim()
    if (next !== value && isProxyValue(next)) void onCommit(next).then(secrets.refresh)
  }
  const savePw = (text: string): void => {
    if (!text || !hasUser) return
    setPw('')
    void window.api.autoSetSecret('proxy', '', text).then((saved) => {
      setSessionOnly(!saved)
      secrets.refresh()
    })
  }
  // Leaving the page with a field still focused saves it too (a shortcut switches views without a blur).
  const latest = useRef({ draft, pw, commit, savePw })
  latest.current = { draft, pw, commit, savePw }
  useEffect(
    () => () => {
      latest.current.commit(latest.current.draft)
      latest.current.savePw(latest.current.pw)
    },
    []
  )

  const pwHint = !hasUser
    ? t('settings.proxyPasswordNoUser')
    : sessionOnly && secrets.persists
      ? t('settings.secretSessionOnly')
      : secrets.persists
      ? t('settings.proxyPasswordHint')
      : t('settings.secretsVolatile')

  return (
    <>
      <EntryRow
        id="address"
        title={t('settings.proxy')}
        mono
        value={draft}
        placeholder={t('settings.proxyPlaceholder')}
        invalid={!valid}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
      />
      <EntryRow
        id="password"
        title={t('settings.proxyPassword')}
        type="password"
        value={pw}
        disabled={!hasUser}
        placeholder={secrets.proxy ? t('auto.secretKept') : ''}
        autoComplete="new-password"
        onChange={(e) => setPw(e.target.value)}
        onBlur={() => savePw(pw)}
        onKeyDown={(e) => e.key === 'Enter' && savePw(pw)}
      />
      <div className="ui-row text-meta text-ink-2" role="note">
        {!valid ? <span className="text-bad">{t('settings.proxyInvalid')}</span> : pwHint}
      </div>
    </>
  )
}
