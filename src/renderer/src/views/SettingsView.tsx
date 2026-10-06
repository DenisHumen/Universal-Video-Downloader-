import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { Folder, Github, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import {
  SUPPORTED_COOKIE_BROWSERS,
  THEMES,
  type AppSettings,
  type DownloadMode,
  type LanguageId,
  type QualityPreset,
  type ThemeId
} from '@shared/types'
import { useStore } from '../store'
import { LANGUAGES, useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import Choice from '../components/Choice'
import ConfirmDialog from '../components/ConfirmDialog'
import AutomationSettings from '../components/AutomationSettings'
import { useSecretState } from '../components/AutomationForms'
import { isSafeTemplate } from '@shared/filename'
import { normaliseRate } from '@shared/rate'
import { isProxyValue, proxyUser } from '@shared/proxy'
import { templateExample, type TemplateExampleOptions } from '../lib/templateExample'

type SectionId =
  | 'appearance'
  | 'downloads'
  | 'processing'
  | 'detection'
  | 'automation'
  | 'access'
  | 'network'
  | 'system'
  | 'updates'
  | 'about'

const SECTIONS: { id: SectionId; label: TranslationKey }[] = [
  { id: 'appearance', label: 'settings.section.appearance' },
  { id: 'downloads', label: 'settings.section.downloads' },
  { id: 'processing', label: 'settings.section.processing' },
  { id: 'detection', label: 'settings.section.detection' },
  { id: 'automation', label: 'settings.section.automation' },
  { id: 'access', label: 'settings.section.access' },
  { id: 'network', label: 'settings.section.network' },
  { id: 'system', label: 'settings.section.system' },
  { id: 'updates', label: 'settings.section.updates' },
  { id: 'about', label: 'settings.section.about' }
]

const THEME_LABEL: Record<ThemeId, TranslationKey> = {
  night: 'settings.theme.night',
  day: 'settings.theme.day'
}

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: 'best', label: 'best' },
  { value: '2160', label: '4K' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' }
]

/** A settings group: a heading rule, then its rows. */
function Group({
  id,
  title,
  children
}: {
  id: SectionId
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section id={`set-${id}`} data-section={id} className="scroll-mt-4 pt-10 first:pt-2">
      <h2 className="label border-b border-edge pb-2.5">{title}</h2>
      <div>{children}</div>
    </section>
  )
}

/**
 * A row: what it is on the left, the control on the right, one hairline below.
 *
 * Every setting uses this shape — the old build split them between `Row`
 * (inline control) and `Field` (control on its own line inside a card), which
 * meant a list of settings had two different silhouettes for no reason the user
 * could see. Wide controls simply wrap under the label.
 */
/**
 * The id of the row's label, so the control beside it can point at one.
 *
 * Every switch on this screen was unnamed: a screen reader read out fourteen
 * "switch, on" in a row with no way to tell which setting any of them was.
 * Passing it down means the row that already draws the text is the one that
 * names the control, and no call site has to repeat the string.
 */
const RowLabelId = createContext<string | undefined>(undefined)

function Row({
  label,
  hint,
  hintMono = false,
  children,
  stack = false
}: {
  label: string
  hint?: string
  /**
   * The hint is a path rather than a sentence. Paths are set in mono like all
   * data, and allowed to break anywhere: a UNC download folder has no spaces
   * to wrap at, and ran 216px out of its 448px column and under the "change"
   * button beside it. Selectable, so the folder can be copied out.
   */
  hintMono?: boolean
  children: ReactNode
  stack?: boolean
}): JSX.Element {
  const labelId = useId()
  return (
    <div
      className={`flex gap-x-6 gap-y-3 border-b border-edge py-4 ${
        stack ? 'flex-col' : 'flex-wrap items-center justify-between'
      }`}
    >
      <div className="min-w-0 max-w-md">
        <p className="text-[14px] text-ink" id={labelId}>
          {label}
        </p>
        {hint &&
          (hintMono ? (
            <p className="hint mono selectable mt-1 [overflow-wrap:anywhere]" title={hint}>
              {hint}
            </p>
          ) : (
            <p className="hint mt-1">{hint}</p>
          ))}
      </div>
      <div className={stack ? '' : 'shrink-0'}>
        <RowLabelId.Provider value={labelId}>{children}</RowLabelId.Provider>
      </div>
    </div>
  )
}

/**
 * A free-text setting, named by the row it sits in.
 *
 * A placeholder is not a name: it vanishes the moment anything is typed, and a
 * screen reader reaching these four announced an unlabelled edit box.
 */
function TextField({
  value,
  onChange,
  placeholder,
  className = 'field mono text-[13px]'
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}): JSX.Element {
  const labelledBy = useContext(RowLabelId)
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-labelledby={labelledBy}
      className={className}
      spellCheck={false}
    />
  )
}

/**
 * The filename template, which is one of two settings that can be refused.
 *
 * Most fields here save on each keystroke, which is fine when nothing can
 * reject the value. This one is checked before it is written, and a
 * rejected template is replaced with the default — so typing the first
 * character of an absolute path, a lone slash or the drive letter, wiped
 * everything already typed and put the default in its place, mid-word, with no
 * explanation. The user was most of the way through a valid template and
 * watched it disappear.
 *
 * So: a draft that is only committed when it is safe, and a line saying why
 * when it is not.
 *
 * Under it, the names the draft would give a video and the same video picked
 * from a playlist (see lib/templateExample.ts), so a template can be got right
 * without downloading something to find out.
 */
function TemplateField({
  value,
  onCommit,
  example: exampleOptions
}: {
  value: string
  onCommit: (v: string) => void
  example: TemplateExampleOptions
}): JSX.Element {
  const t = useT()
  const labelledBy = useContext(RowLabelId)
  const exampleId = useId()
  const [draft, setDraft] = useState(value)

  // Follow the store when it changes underneath us — a reset, most obviously.
  useEffect(() => setDraft(value), [value])

  const safe = isSafeTemplate(draft)
  const example = safe ? templateExample(draft, exampleOptions) : null

  return (
    <>
      <input
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          if (isSafeTemplate(next)) onCommit(next)
        }}
        onBlur={() => {
          if (isSafeTemplate(draft)) onCommit(draft)
          else setDraft(value)
        }}
        aria-labelledby={labelledBy}
        aria-describedby={example ? exampleId : undefined}
        aria-invalid={!safe}
        className="field mono text-[13px]"
        spellCheck={false}
      />
      {!safe && <p className="hint mt-1.5 text-bad">{t('settings.filenameTemplateUnsafe')}</p>}
      {example && (
        <dl id={exampleId} className="mt-2.5 space-y-1.5">
          <div>
            <dt className="hint">{t('settings.templateExample')}</dt>
            <dd className="mono selectable text-[12px] text-ink-2 [overflow-wrap:anywhere]">
              {example.video}
            </dd>
          </div>
          {example.playlist && (
            <div>
              <dt className="hint">{t('settings.templateExamplePlaylist')}</dt>
              <dd className="mono selectable text-[12px] text-ink-2 [overflow-wrap:anywhere]">
                {example.playlist}
              </dd>
            </div>
          )}
        </dl>
      )}
    </>
  )
}

/**
 * The speed limit, which the engine reads far more strictly than people write.
 *
 * It used to save every keystroke as typed, and yt-dlp refuses anything but a
 * number and a bare K, M or G - so "2MB", "1,5M" or a Russian "2 Мб" made every
 * later download fail with a usage error that never mentioned this field. Now
 * the draft is read into the engine's form and committed only once it is one;
 * until then the stored limit stands and a line says what is expected.
 */
function SpeedLimitField({
  value,
  onCommit
}: {
  value: string
  onCommit: (v: string) => void
}): JSX.Element {
  const t = useT()
  const labelledBy = useContext(RowLabelId)
  const hintId = useId()
  const [draft, setDraft] = useState(value)

  /*
    Follow the store when it changes underneath us - a reset - but not when the
    change is our own commit coming back normalised. Otherwise a Cyrillic "2М"
    would turn Latin under the cursor, and "2MB" would lose its B mid-word.
  */
  useEffect(() => setDraft((d) => (normaliseRate(d) === value ? d : value)), [value])

  const valid = normaliseRate(draft) !== null

  return (
    <div className="flex flex-col items-end">
      <input
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          const rate = normaliseRate(next)
          if (rate !== null) onCommit(rate)
        }}
        onBlur={() => setDraft(normaliseRate(draft) ?? value)}
        placeholder="2M"
        aria-labelledby={labelledBy}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : hintId}
        className="field mono w-36 text-[13px]"
        spellCheck={false}
      />
      {!valid && (
        <p id={hintId} className="hint mt-1.5 max-w-[16rem] text-right text-bad">
          {t('settings.speedLimitInvalid')}
        </p>
      )}
    </div>
  )
}

/**
 * The proxy, saved when the user is done with it rather than per keystroke.
 *
 * Saving the proxy reconfigures the app's own network, so a field that saved on
 * every change applied every prefix of the address on the way to it - `h`,
 * `ht`, `http` - and downloads resolving at that moment were sent to hosts that
 * do not exist, while the log gained a line per letter.
 *
 * Committed on blur, on Enter, and when the screen goes away with the field
 * still focused: a keyboard shortcut switches views without a blur. A value
 * without the shape of a proxy address is not committed at all. It stays in the
 * field, marked, with a line saying why, and the previous setting stays in
 * effect - rather than being silently put back the way the template is.
 *
 * A password typed into the address does not stay on screen. The app moves it
 * to the secret store and answers with the address without it, which the field
 * then shows - also when only the password changed, and the address it gets
 * back is the one it already had.
 */
function ProxyField({
  value,
  onCommit,
  onDraft,
  placeholder
}: {
  value: string
  onCommit: (v: string) => Promise<void>
  onDraft: (v: string) => void
  placeholder?: string
}): JSX.Element {
  const t = useT()
  const labelledBy = useContext(RowLabelId)
  const hintId = useId()
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(0)

  // Follow the store when it changes underneath us — a reset, most obviously.
  useEffect(() => setDraft(value), [value, saved])
  useEffect(() => onDraft(draft), [draft, onDraft])

  const commit = (text: string): void => {
    const next = text.trim()
    if (next !== value && isProxyValue(next)) {
      void onCommit(next).then(() => setSaved((n) => n + 1))
    }
  }

  // The cleanup below is created once, so it reads the latest draft from here.
  const latest = useRef({ draft, commit })
  latest.current = { draft, commit }
  useEffect(() => () => latest.current.commit(latest.current.draft), [])

  const valid = isProxyValue(draft)

  return (
    <>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit(draft)
          if (valid) setDraft(draft.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft)
        }}
        placeholder={placeholder}
        aria-labelledby={labelledBy}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : hintId}
        className="field mono text-[13px]"
        spellCheck={false}
      />
      {!valid && (
        <p id={hintId} className="hint mt-1.5 text-bad">
          {t('settings.proxyInvalid')}
        </p>
      )}
    </>
  )
}

/**
 * The proxy's password, in a box of its own that never shows it.
 *
 * Like a share's password: the screen is told whether one is stored, never
 * what it is, and an empty box leaves the stored one alone. Saved on blur and
 * Enter like the address above, and when the screen goes away mid-typing.
 */
function ProxyPasswordField({
  enabled,
  stored,
  onSave
}: {
  enabled: boolean
  stored: boolean
  onSave: (password: string) => Promise<void>
}): JSX.Element {
  const t = useT()
  const labelledBy = useContext(RowLabelId)
  const [draft, setDraft] = useState('')

  const save = (text: string): void => {
    if (!text || !enabled) return
    setDraft('')
    void onSave(text)
  }

  const latest = useRef({ draft, save })
  latest.current = { draft, save }
  useEffect(() => () => latest.current.save(latest.current.draft), [])

  return (
    <input
      type="password"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => save(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(draft)
      }}
      disabled={!enabled}
      placeholder={stored ? t('auto.secretKept') : ''}
      aria-labelledby={labelledBy}
      autoComplete="new-password"
      className="field mono text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
      spellCheck={false}
    />
  )
}

/**
 * The address and its password, which only make sense together.
 *
 * The password is only ever sent with a user name, so the box opens as soon
 * as the address being typed has one - from the draft, not the saved value,
 * or the click that leaves the address would land on a box still disabled.
 */
function ProxySettings({
  value,
  onCommit
}: {
  value: string
  onCommit: (v: string) => Promise<void>
}): JSX.Element {
  const t = useT()
  const secrets = useSecretState()
  const [draft, setDraft] = useState(value)
  const hasUser = Boolean(proxyUser(isProxyValue(draft) ? draft : value))

  // A reset forgets the password along with the address; so does dropping the user.
  useEffect(secrets.refresh, [value, secrets.refresh])

  const hint = !hasUser
    ? t('settings.proxyPasswordNoUser')
    : secrets.persists
      ? t('settings.proxyPasswordHint')
      : t('settings.secretsVolatile')

  return (
    <>
      <Row label={t('settings.proxy')} stack>
        <ProxyField
          value={value}
          onCommit={async (v) => {
            await onCommit(v)
            // A password pasted into the address is stored by now.
            secrets.refresh()
          }}
          onDraft={setDraft}
          placeholder={t('settings.proxyPlaceholder')}
        />
      </Row>
      <Row label={t('settings.proxyPassword')} hint={hint} stack>
        <ProxyPasswordField
          enabled={hasUser}
          stored={secrets.proxy}
          onSave={async (password) => {
            await window.api.autoSetSecret('proxy', '', password)
            secrets.refresh()
          }}
        />
      </Row>
    </>
  )
}

/**
 * A switch, not a pill with a floating knob: a track that fills with the accent
 * and a knob that slides on a CSS transition rather than a spring, because a
 * binary control has nothing to be springy about.
 */
function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  const labelledBy = useContext(RowLabelId)
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-labelledby={labelledBy}
      /* 44x24 is the right *look* for a switch and a small target to hit, so
         a pseudo-element extends the clickable area to 44x40 without changing
         a pixel of what's drawn. */
      className={`no-drag relative h-6 w-11 shrink-0 cursor-pointer rounded-full border outline-offset-2 transition-colors duration-fast ease-ease before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        value ? 'border-accent bg-accent' : 'border-edge-strong bg-sink'
      }`}
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-[left,background-color] duration-fast ease-ease ${
          value ? 'left-[24px] bg-accent-fg' : 'left-[3px] bg-ink-2'
        }`}
      />
    </button>
  )
}

/**
 * Settings as one scrolling document with a sticky index.
 *
 * The old screen was nine mutually exclusive panes behind a 186px side rail:
 * you could only ever see one group, and finding a setting meant remembering
 * which of nine buckets someone had filed it in. A single document can be
 * scrolled and searched with the OS's own find; the index just marks where you
 * are and jumps you around.
 */
export default function SettingsView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const ytdlp = useStore((s) => s.ytdlp)
  const update = useStore((s) => s.update)
  const save = useStore((s) => s.saveSettings)
  const reset = useStore((s) => s.resetSettings)

  const [active, setActive] = useState<SectionId>('appearance')
  const [checking, setChecking] = useState(false)
  const [updatingEngine, setUpdatingEngine] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Mark the index against whatever is nearest the top of the viewport. The
  // top-biased root margin keeps the last short section reachable — without it
  // "about" can never win, because it's too short to cross the middle line.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.getAttribute('data-section') as SectionId)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    )
    root.querySelectorAll('[data-section]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [settings])

  /*
    An instant scroll, computed rather than smooth.

    Smooth scrolling is driven by the frame clock, and this app has already
    learned twice over what that costs: measured with the clock stalled — a
    backgrounded window, which is the normal state of a downloader — the tab
    strip's own arrows moved nothing at all. A section index that sometimes
    does nothing is worse than one that jumps.
  */
  const jump = (id: SectionId): void => {
    const host = scrollRef.current
    const target = host?.querySelector<HTMLElement>(`#set-${id}`)
    if (!host || !target) return
    host.scrollTop = Math.max(0, target.offsetTop - host.offsetTop)
    setActive(id)
  }

  if (!settings) return <div />

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    void save({ [key]: value } as Partial<AppSettings>)
  }

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) set('downloadDir', dir)
  }
  const chooseCookies = async (): Promise<void> => {
    const file = await window.api.chooseCookiesFile()
    if (file) set('cookiesFile', file)
  }
  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    await window.api.checkForUpdates()
    setTimeout(() => setChecking(false), 1500)
  }
  const updateEngine = async (): Promise<void> => {
    setUpdatingEngine(true)
    try {
      const res = await window.api.updateYtdlp()
      if (res.ok) toast(t('settings.engineUpdated'), 'success')
      // Main refuses to swap the binary out from under a running transfer.
      else toast(res.code === 'engineBusy' ? t('err.engineBusy') : t('settings.engineFailed'), 'error')
    } catch {
      toast(t('settings.engineFailed'), 'error')
    } finally {
      setUpdatingEngine(false)
    }
  }
  /*
    This throws away the download folder, the cookies file, the proxy and every
    other choice the user has ever made here, and it used to happen on one
    click of a button sitting in the middle of a list of ordinary toggles.
  */
  const resetAll = async (): Promise<void> => {
    setConfirmReset(false)
    await reset()
    toast(t('settings.resetDone'), 'success')
  }

  return (
    <div className="flex h-full min-h-0">
      {/*
        A rail down the side, not a strip across the top.

        The strip was a row of tabs that scrolled, and it worked while there
        were five of them. There are now more than fit any sensible window, so
        most of the list was permanently off-screen behind an arrow - which is
        the one affordance you cannot use without first noticing it. Down the
        side every section is visible at once and the list can keep growing.
      */}
      <aside className="flex w-[190px] shrink-0 flex-col border-r border-edge">
        <h1 className="h1 shrink-0 px-4 pb-3 pt-8">{t('settings.title')}</h1>
        <nav
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('settings.title')}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-6"
        >
        {/*
          An underline strip, not a pill row.
          The index was styled with `.choice` at first, which is the app's
          *selection* control — so the section index looked exactly like the
          radio groups it scrolls to, and nothing said which one changed a
          setting and which one just moved the page.
        */}
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => jump(s.id)}
              role="tab"
              aria-selected={active === s.id}
              className={`w-full rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                active === s.id ? 'bg-raise text-ink' : 'text-ink-2 hover:bg-raise/60'
              }`}
            >
              {t(s.label)}
            </button>
          ))}
        </nav>
      </aside>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-24 pt-8">
          <Group id="appearance" title={t('settings.section.appearance')}>
            <Row label={t('settings.language')}>
              <Choice
                label={t('settings.language')}
                value={settings.language}
                onChange={(v) => set('language', v as LanguageId)}
                options={LANGUAGES.map((l) => ({
                  value: l.id,
                  label: l.id === 'auto' ? t('settings.language.auto') : l.label
                }))}
              />
            </Row>
            <Row label={t('settings.theme')}>
              <Choice
                label={t('settings.theme')}
                value={settings.theme}
                onChange={(v) => set('theme', v as ThemeId)}
                options={THEMES.map((id) => ({ value: id, label: t(THEME_LABEL[id]) }))}
              />
            </Row>
          </Group>

          <Group id="downloads" title={t('settings.section.downloads')}>
            <Row label={t('settings.saveLocation')} hint={settings.downloadDir} hintMono>
              <button className="btn-quiet" onClick={chooseFolder}>
                <Folder size={14} /> {t('common.change')}
              </button>
            </Row>
            <Row label={t('settings.subfolders')} hint={t('settings.subfoldersHint')}>
              <Switch value={settings.createSubfolders} onChange={(v) => set('createSubfolders', v)} />
            </Row>
            <Row label={t('settings.defaultMode')}>
              <Choice
                label={t('settings.defaultMode')}
                value={settings.defaultMode}
                onChange={(v) => set('defaultMode', v as DownloadMode)}
                options={[
                  { value: 'video', label: t('common.video') },
                  { value: 'audio', label: t('common.audioOnly') }
                ]}
              />
            </Row>
            <Row label={t('settings.defaultQuality')} hint={t('settings.defaultQualityHint')} stack>
              <Choice
                label={t('settings.defaultQuality')}
                value={settings.defaultQuality === 'audio' ? 'best' : settings.defaultQuality}
                onChange={(v) => set('defaultQuality', v as QualityPreset)}
                options={QUALITY_OPTIONS.map((q) => ({
                  value: q.value,
                  label: q.value === 'best' ? t('common.best') : q.label
                }))}
              />
            </Row>
            <Row label={t('settings.audioFormat')} hint={t('settings.audioFormatHint')} stack>
              <Choice
                label={t('settings.audioFormat')}
                value={settings.audioFormat}
                onChange={(v) => set('audioFormat', v)}
                options={['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'].map((f) => ({
                  value: f,
                  label: <span className="uppercase">{f}</span>
                }))}
              />
            </Row>
            <Row label={t('settings.concurrent')}>
              <Choice
                label={t('settings.concurrent')}
                value={String(settings.concurrentDownloads)}
                onChange={(v) => set('concurrentDownloads', Number(v))}
                options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
              />
            </Row>
            <Row label={t('settings.resumeOnLaunch')} hint={t('settings.resumeOnLaunchHint')}>
              <Switch value={settings.resumeOnLaunch} onChange={(v) => set('resumeOnLaunch', v)} />
            </Row>
            <Row label={t('settings.speedLimit')} hint={t('settings.speedLimitHint')}>
              <SpeedLimitField
                value={settings.speedLimit}
                onCommit={(v) => set('speedLimit', v)}
              />
            </Row>
            <Row label={t('settings.playlistLimit')} hint={t('settings.playlistLimitHint')} stack>
              <Choice
                label={t('settings.playlistLimit')}
                value={String(settings.playlistLimit)}
                onChange={(v) => set('playlistLimit', Number(v))}
                options={['50', '200', '500', '1000', '5000'].map((n) => ({ value: n, label: n }))}
              />
            </Row>
          </Group>

          <Group id="processing" title={t('settings.section.processing')}>
            <Row label={t('settings.embedThumbnail')} hint={t('settings.embedThumbnailHint')}>
              <Switch value={settings.embedThumbnail} onChange={(v) => set('embedThumbnail', v)} />
            </Row>
            <Row label={t('settings.embedMetadata')} hint={t('settings.embedMetadataHint')}>
              <Switch value={settings.embedMetadata} onChange={(v) => set('embedMetadata', v)} />
            </Row>
            <Row label={t('settings.embedChapters')} hint={t('settings.embedChaptersHint')}>
              <Switch value={settings.embedChapters} onChange={(v) => set('embedChapters', v)} />
            </Row>
            <Row label={t('settings.embedSubtitles')} hint={t('settings.embedSubtitlesHint')}>
              <Switch value={settings.embedSubtitles} onChange={(v) => set('embedSubtitles', v)} />
            </Row>
            <Row label={t('settings.writeSubtitles')} hint={t('settings.writeSubtitlesHint')}>
              <Switch value={settings.writeSubtitles} onChange={(v) => set('writeSubtitles', v)} />
            </Row>
            <Row label={t('settings.subtitleLanguages')} hint={t('settings.subtitleLanguagesHint')}>
              <TextField
                value={settings.subtitleLanguages}
                onChange={(v) => set('subtitleLanguages', v)}
                placeholder="en,ru"
                className="field mono w-44 text-[13px]"
              />
            </Row>
            <Row label={t('settings.sponsorBlock')} hint={t('settings.sponsorBlockHint')}>
              <Switch value={settings.sponsorBlock} onChange={(v) => set('sponsorBlock', v)} />
            </Row>
            <Row
              label={t('settings.preferCompatible')}
              hint={t('settings.preferCompatibleHint')}
            >
              <Switch
                value={settings.preferCompatible}
                onChange={(v) => set('preferCompatible', v)}
              />
            </Row>
            <Row label={t('settings.restrictFilenames')} hint={t('settings.restrictFilenamesHint')}>
              <Switch value={settings.restrictFilenames} onChange={(v) => set('restrictFilenames', v)} />
            </Row>
            <Row label={t('settings.filenameTemplate')} hint={t('settings.filenameTemplateHint')} stack>
              <TemplateField
                value={settings.filenameTemplate}
                onCommit={(v) => set('filenameTemplate', v)}
                example={{
                  restrictFilenames: settings.restrictFilenames,
                  siteFolders: settings.createSubfolders,
                  playlistFolder: settings.playlistFolder,
                  playlistNumbering: settings.playlistNumbering,
                  sep: appInfo?.platform === 'win32' ? '\\' : '/'
                }}
              />
            </Row>
          </Group>

          <Group id="detection" title={t('settings.section.detection')}>
            <Row label={t('settings.universal')} hint={t('settings.universalHint')}>
              <Switch value={settings.universalFallback} onChange={(v) => set('universalFallback', v)} />
            </Row>
          </Group>

          <Group id="automation" title={t('settings.section.automation')}>
            <AutomationSettings />
            <Row label={t('settings.background')} hint={t('settings.backgroundHint')}>
              <Switch
                value={settings.automationEnabled}
                onChange={(v) => set('automationEnabled', v)}
              />
            </Row>
            <Row label={t('settings.autostart')} hint={t('settings.autostartHint')}>
              <Switch value={settings.autostart} onChange={(v) => set('autostart', v)} />
            </Row>
            <Row label={t('settings.logVerbose')} hint={t('settings.logVerboseHint')}>
              <Switch value={settings.logVerbose} onChange={(v) => set('logVerbose', v)} />
            </Row>
            <Row label={t('settings.logRow')}>
              <button
                className="btn-quiet"
                onClick={async () => window.api.showInFolder(await window.api.getLogPath())}
              >
                {t('settings.openLog')}
              </button>
            </Row>
          </Group>

          <Group id="access" title={t('settings.section.access')}>
            <Row label={t('settings.cookies')} hint={t('settings.cookiesHint')} stack>
              <Choice
                label={t('settings.cookies')}
                value={settings.cookiesFromBrowser}
                onChange={(v) => set('cookiesFromBrowser', v)}
                options={[
                  { value: '', label: t('common.off') },
                  ...SUPPORTED_COOKIE_BROWSERS.map((b) => ({ value: b, label: b }))
                ]}
              />
            </Row>
            <Row
              label={t('settings.cookiesFile')}
              hint={settings.cookiesFile || t('settings.cookiesFileHint')}
              hintMono={!!settings.cookiesFile}
            >
              <div className="flex items-center gap-2">
                {settings.cookiesFile && (
                  <button className="btn-quiet" onClick={() => set('cookiesFile', '')}>
                    {t('settings.cookiesFileClear')}
                  </button>
                )}
                <button className="btn-quiet" onClick={chooseCookies}>
                  <Folder size={14} /> {t('settings.cookiesFileChoose')}
                </button>
              </div>
            </Row>
          </Group>

          <Group id="network" title={t('settings.section.network')}>
            <ProxySettings value={settings.proxy} onCommit={(v) => save({ proxy: v })} />
          </Group>

          <Group id="system" title={t('settings.section.system')}>
            <Row label={t('settings.notifications')} hint={t('settings.notificationsHint')}>
              <Switch value={settings.notifications} onChange={(v) => set('notifications', v)} />
            </Row>
            <Row label={t('settings.clipboardWatch')} hint={t('settings.clipboardWatchHint')}>
              <Switch value={settings.clipboardWatch} onChange={(v) => set('clipboardWatch', v)} />
            </Row>
            <Row label={t('settings.tray')} hint={t('settings.trayHint')}>
              <Switch value={settings.trayEnabled} onChange={(v) => set('trayEnabled', v)} />
            </Row>
            {/* On or off, never "send by itself": on still asks every time. */}
            <Row label={t('settings.errorReports')} hint={t('settings.errorReportsHint')}>
              <Switch
                value={settings.errorReports !== 'off'}
                onChange={(v) => set('errorReports', v ? 'ask' : 'off')}
              />
            </Row>
            <Row label={t('settings.reset')}>
              <button className="btn-danger" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={14} /> {t('settings.reset')}
              </button>
            </Row>
          </Group>

          <Group id="updates" title={t('settings.section.updates')}>
            <Row label={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
              <Switch value={settings.autoUpdate} onChange={(v) => set('autoUpdate', v)} />
            </Row>
            <Row
              label={t('settings.appVersion')}
              hint={
                update.state === 'available'
                  ? t('settings.updateAvailable', { version: update.version ?? '' })
                  : update.state === 'error'
                    ? update.message || t('update.failed')
                    : update.state === 'not-available'
                      ? t('settings.upToDate')
                      : `v${appInfo?.version ?? '—'}`
              }
            >
              <button className="btn-quiet" onClick={checkUpdates} disabled={checking}>
                {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {t('common.check')}
              </button>
            </Row>
            {appInfo?.manualUpdates && (
              <Row label={t('settings.manualUpdates')} hint={t('settings.manualUpdatesHint')}>
                <button className="btn-quiet" onClick={() => window.api.openReleasesPage()}>
                  {t('common.open')}
                </button>
              </Row>
            )}
            <Row
              label={t('settings.engine')}
              hint={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || 'yt-dlp'}
            >
              <button className="btn-quiet" onClick={updateEngine} disabled={updatingEngine}>
                {updatingEngine ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t('common.update')}
              </button>
            </Row>
          </Group>

          <Group id="about" title={t('settings.section.about')}>
            <div className="border-b border-edge py-4">
              <p className="hint">{t('settings.about')}</p>
              <button
                className="btn-quiet mt-4"
                onClick={() =>
                  window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
                }
              >
                <Github size={14} /> {t('settings.viewOnGithub')}
              </button>
              <p className="mono mt-4 text-[12px] text-ink-3">
                v{appInfo?.version} · {appInfo?.platform} · {appInfo?.arch}
              </p>
            </div>
          </Group>
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title={t('settings.resetConfirm')}
          body={t('settings.resetConfirmBody')}
          confirmLabel={t('settings.reset')}
          onConfirm={resetAll}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  )
}
