import { useEffect, useState, type ReactNode } from 'react'
import { ACCENTS, type AccentChoice } from '@shared/accent'
import { AUTO_SOURCES } from '@shared/auto-sources'
import { parseProxy } from '@shared/proxy'
import {
  SUPPORTED_COOKIE_BROWSERS,
  cookieBrowsersFor,
  type AppSettings,
  type CliStatus,
  type DownloadMode,
  type LanguageId,
  type QualityPreset,
  type SavedSiteLogins,
  type SignInImport,
  type ThemeId
} from '@shared/types'
import type { BackupError, ImportCounts } from '@shared/backup'
import { useStore } from '../../store'
import { audioFormatLabel } from '../../lib/format'
import { useT, useTp, type TranslationKey } from '../../i18n'
import { toast } from '../../lib/toast'
import { describeError } from '../../lib/errors'
import { describeCliCommand } from '../../lib/cliCommand'
import { updateErrorDetail, updateErrorText } from '../../lib/updateError'
import { engineFailureText } from '../../lib/engineError'
import AutomationSettings from '../../components/AutomationSettings'
import { useSecretState } from '../../components/AutomationForms'
import ConfirmDialog from '../../components/ConfirmDialog'
import Logo from '../../components/Logo'
import {
  AccentSwatches,
  ActionRow,
  ComboRow,
  PreferencesGroup,
  PreferencesPage,
  SegmentedControl,
  Spinner,
  StyleTiles,
  SwitchRow,
  useRowTitleId,
  type TileStyle
} from '../../ui'
import { formatRoute, type Route } from './router'
import { DraftEntryRow, ProxyRows, SpeedLimitField, TemplateRow } from './fields'

/*
  The panels and subpages of Settings, as GNOME Settings lays them out
  (A1.1 §2). Every row keeps an id: searchIndex.ts links to it, and so do the
  Fix buttons, first-run and Ctrl+K.
*/

export interface PanelProps {
  settings: AppSettings
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  /** Push a subpage of this panel (or any route). */
  go: (route: Route) => void
}

const QUALITY: { value: QualityPreset; label: string }[] = [
  { value: 'best', label: '' },
  { value: '2160', label: '4K' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' }
]

export const ACCENT_LABEL: Record<AccentChoice, TranslationKey> = {
  orange: 'prefs.accent.orange',
  blue: 'prefs.accent.blue',
  teal: 'prefs.accent.teal',
  green: 'prefs.accent.green',
  yellow: 'prefs.accent.yellow',
  red: 'prefs.accent.red',
  pink: 'prefs.accent.pink',
  purple: 'prefs.accent.purple',
  slate: 'prefs.accent.slate',
  brown: 'prefs.accent.brown',
  system: 'prefs.accent.system'
}

const LANGUAGE_LABEL: Record<LanguageId, TranslationKey> = {
  auto: 'prefs.language.auto',
  en: 'prefs.language.en',
  ru: 'prefs.language.ru'
}

/* ---------------------------------------------------------------- Appearance */

export function AppearancePanel({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const systemAccent = useStore((s) => s.appInfo?.systemAccent)
  // "System" only where the desktop answered (E2): GNOME 46's portal has no accent key.
  const accents: AccentChoice[] = systemAccent ? [...ACCENTS, 'system'] : [...ACCENTS]
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.style')} id="style">
        <div className="px-3 py-5">
          <StyleTiles
            label={t('prefs.group.style')}
            value={settings.theme as TileStyle}
            accent={settings.accent === 'system' ? undefined : settings.accent}
            onChange={(v) => set('theme', v as ThemeId)}
            options={[
              { value: 'day', label: t('prefs.style.day') },
              { value: 'night', label: t('prefs.style.night') },
              { value: 'system', label: t('prefs.style.system') }
            ]}
          />
        </div>
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.accent')} id="accent">
        <div className="px-4 py-4">
          <AccentSwatches
            label={t('prefs.group.accent')}
            value={settings.accent}
            onChange={(v) => set('accent', v as AccentChoice)}
            options={accents.map((a) => ({ value: a, label: t(ACCENT_LABEL[a]) }))}
          />
        </div>
      </PreferencesGroup>
      <PreferencesGroup>
        <ComboRow
          id="language"
          title={t('prefs.row.language')}
          value={settings.language}
          onChange={(v) => set('language', v as LanguageId)}
          options={(['auto', 'en', 'ru'] as LanguageId[]).map((id) => ({ value: id, label: t(LANGUAGE_LABEL[id]) }))}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Downloads */

function ModeToggle({ value, onChange }: { value: DownloadMode; onChange: (v: DownloadMode) => void }): JSX.Element {
  const t = useT()
  const labelledBy = useRowTitleId()
  return (
    <span aria-labelledby={labelledBy} className="contents">
      <SegmentedControl
        label={t('settings.defaultMode')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'video', label: t('common.video') },
          { value: 'audio', label: t('common.audioOnly') }
        ]}
      />
    </span>
  )
}

export function DownloadsPanel({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) set('downloadDir', dir)
  }
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.location')}>
        <ActionRow
          id="saveLocation"
          title={t('settings.saveLocation')}
          subtitle={<span className="selectable [overflow-wrap:anywhere]">{settings.downloadDir}</span>}
          monoSubtitle
          suffix={
            <button className="btn-quiet" onClick={chooseFolder}>
              {t('common.change')}
            </button>
          }
        />
        <SwitchRow
          id="subfolders"
          title={t('settings.subfolders')}
          subtitle={t('settings.subfoldersHint')}
          checked={settings.createSubfolders}
          onChange={(v) => set('createSubfolders', v)}
        />
      </PreferencesGroup>

      <PreferencesGroup title={t('prefs.group.defaults')}>
        <ActionRow
          id="defaultMode"
          title={t('settings.defaultMode')}
          suffix={<ModeToggle value={settings.defaultMode} onChange={(v) => set('defaultMode', v)} />}
        />
        <ComboRow
          id="quality"
          title={t('settings.defaultQuality')}
          subtitle={t('settings.defaultQualityHint')}
          value={settings.defaultQuality === 'audio' ? 'best' : settings.defaultQuality}
          onChange={(v) => set('defaultQuality', v as QualityPreset)}
          options={QUALITY.map((q) => ({ value: q.value, label: q.value === 'best' ? t('common.best') : q.label }))}
        />
        <ComboRow
          id="audioFormat"
          title={t('settings.audioFormat')}
          subtitle={t('settings.audioFormatHint')}
          value={settings.audioFormat}
          onChange={(v) => set('audioFormat', v)}
          options={['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'].map((f) => ({ value: f, label: audioFormatLabel(f) }))}
        />
      </PreferencesGroup>

      <PreferencesGroup title={t('prefs.group.queue')}>
        <ComboRow
          id="concurrent"
          title={t('settings.concurrent')}
          value={String(settings.concurrentDownloads)}
          onChange={(v) => set('concurrentDownloads', Number(v))}
          options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
        />
        <SwitchRow
          id="resume"
          title={t('settings.resumeOnLaunch')}
          subtitle={t('settings.resumeOnLaunchHint')}
          checked={settings.resumeOnLaunch}
          onChange={(v) => set('resumeOnLaunch', v)}
        />
        <ComboRow
          id="keepFinished"
          title={t('settings.keepFinished')}
          subtitle={t('settings.keepFinishedHint')}
          value={String(settings.keepFinished ?? 0)}
          onChange={(v) => set('keepFinished', Number(v))}
          options={['0', '50', '100', '500', '1000'].map((n) => ({
            value: n,
            label: n === '0' ? t('settings.keepFinished.all') : n
          }))}
        />
        <ActionRow
          id="speedLimit"
          title={t('settings.speedLimit')}
          subtitle={t('settings.speedLimitHint')}
          suffix={<SpeedLimitField value={settings.speedLimit} onCommit={(v) => set('speedLimit', v)} />}
        />
        <ComboRow
          id="playlistLimit"
          title={t('settings.playlistLimit')}
          subtitle={t('settings.playlistLimitHint')}
          value={String(settings.playlistLimit)}
          onChange={(v) => set('playlistLimit', Number(v))}
          options={['50', '200', '500', '1000', '5000'].map((n) => ({ value: n, label: n }))}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Post-processing */

export function ProcessingPanel({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const platform = useStore((s) => s.appInfo?.platform)
  const sw = (id: string, key: keyof AppSettings, label: TranslationKey, sub: TranslationKey): ReactNode => (
    <SwitchRow
      id={id}
      title={t(label)}
      subtitle={t(sub)}
      checked={Boolean(settings[key])}
      onChange={(v) => set(key, v as never)}
    />
  )
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.embed')}>
        {sw('thumbnail', 'embedThumbnail', 'settings.embedThumbnail', 'settings.embedThumbnailHint')}
        {sw('metadata', 'embedMetadata', 'settings.embedMetadata', 'settings.embedMetadataHint')}
        {sw('chapters', 'embedChapters', 'settings.embedChapters', 'settings.embedChaptersHint')}
        {sw('embedSubtitles', 'embedSubtitles', 'settings.embedSubtitles', 'settings.embedSubtitlesHint')}
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.subtitles')} footer={t('settings.subtitleLanguagesHint')}>
        {sw('writeSubtitles', 'writeSubtitles', 'settings.writeSubtitles', 'settings.writeSubtitlesHint')}
        <DraftEntryRow
          id="subtitleLanguages"
          title={t('settings.subtitleLanguages')}
          mono
          value={settings.subtitleLanguages}
          placeholder="en,ru"
          spellCheck={false}
          onCommit={(v) => set('subtitleLanguages', v)}
        />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.formats')}>
        {sw('sponsorBlock', 'sponsorBlock', 'settings.sponsorBlock', 'settings.sponsorBlockHint')}
        {sw('compatible', 'preferCompatible', 'settings.preferCompatible', 'settings.preferCompatibleHint')}
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.fileNames')} footer={t('settings.filenameTemplateHint')}>
        {sw('restrict', 'restrictFilenames', 'settings.restrictFilenames', 'settings.restrictFilenamesHint')}
        <TemplateRow
          value={settings.filenameTemplate}
          onCommit={(v) => set('filenameTemplate', v)}
          example={{
            restrictFilenames: settings.restrictFilenames,
            siteFolders: settings.createSubfolders,
            playlistFolder: settings.playlistFolder,
            playlistNumbering: settings.playlistNumbering,
            sep: platform === 'win32' ? '\\' : '/'
          }}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Watching */

export function WatchingPanel({ settings, set, go }: PanelProps): JSX.Element {
  const t = useT()
  // A chat with no bot token sends nothing: a backup restores the chat but never the token.
  const secrets = useSecretState()
  const shares = settings.smbTargets?.length ?? 0
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.background')}>
        <SwitchRow
          id="background"
          title={t('settings.background')}
          subtitle={t('settings.backgroundHint')}
          checked={settings.automationEnabled}
          onChange={(v) => set('automationEnabled', v)}
        />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.destinations')}>
        <ActionRow
          id="shares"
          title={t('prefs.sub.shares')}
          value={shares ? String(shares) : t('prefs.value.none')}
          navigation
          onActivate={() => go({ panel: 'watching', sub: ['shares'] })}
        />
        <ActionRow
          id="telegram"
          title={t('prefs.sub.telegram')}
          value={settings.telegramChatId ? (secrets.telegram ? t('prefs.value.on') : t('prefs.value.noToken')) : t('prefs.value.off')}
          navigation
          onActivate={() => go({ panel: 'watching', sub: ['telegram'] })}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

export function SharesPage(): JSX.Element {
  return (
    <PreferencesPage>
      <AutomationSettings part="shares" />
    </PreferencesPage>
  )
}

export function TelegramPage(): JSX.Element {
  return (
    <PreferencesPage>
      <AutomationSettings part="telegram" />
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Detection */

export function DetectionPanel({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.autoDownload')}>
        <SwitchRow
          id="autoDownload"
          title={t('settings.autoDownload')}
          subtitle={t('settings.autoDownloadHint')}
          checked={settings.autoDownload}
          onChange={(v) => set('autoDownload', v)}
        />
      </PreferencesGroup>
      {settings.autoDownload && (
        <PreferencesGroup title={t('prefs.group.autoSources')}>
          {AUTO_SOURCES.map((source) => (
            <SwitchRow
              key={source.id}
              id={`auto-${source.id}`}
              title={source.name}
              checked={!settings.autoDownloadOff.includes(source.id)}
              onChange={(on) =>
                set(
                  'autoDownloadOff',
                  on
                    ? settings.autoDownloadOff.filter((id) => id !== source.id)
                    : [...settings.autoDownloadOff, source.id]
                )
              }
            />
          ))}
        </PreferencesGroup>
      )}
      <PreferencesGroup title={t('prefs.group.fallback')}>
        <SwitchRow
          id="universal"
          title={t('settings.universal')}
          subtitle={t('settings.universalHint')}
          checked={settings.universalFallback}
          onChange={(v) => set('universalFallback', v)}
        />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.services')}>
        <SwitchRow
          id="adult"
          title={t('settings.adultServices')}
          subtitle={t('settings.adultServicesHint')}
          checked={settings.showAdultServices}
          onChange={(v) => set('showAdultServices', v)}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Access & Cookies */

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

export function AccessPanel({ settings, set, go }: PanelProps): JSX.Element {
  const t = useT()
  const platform = useStore((s) => s.appInfo?.platform)
  const [signOut, setSignOut] = useState(false)
  return (
    <PreferencesPage>
      {/*
        First: signing in on the site itself is what most people try, and it
        works with nothing else set up - the engine is given the browser's
        cookies whenever no other cookies are chosen below.
      */}
      <PreferencesGroup title={t('prefs.group.builtInBrowser')} description={t('prefs.group.builtInBrowserHint')}>
        <SwitchRow
          id="browserStaySignedIn"
          title={t('prefs.row.browserSignedIn')}
          subtitle={t('prefs.row.browserSignedInHint')}
          checked={settings.browserStaySignedIn}
          onChange={(v) => set('browserStaySignedIn', v)}
        />
        <SwitchRow
          id="browserSavePasswords"
          title={t('prefs.row.browserPasswords')}
          subtitle={t('prefs.row.browserPasswordsHint')}
          checked={settings.browserSavePasswords}
          onChange={(v) => set('browserSavePasswords', v)}
        />
        <ActionRow
          id="importSignIns"
          title={t('prefs.sub.importSignIns')}
          subtitle={t('prefs.row.importSignInsHint')}
          navigation
          onActivate={() => go({ panel: 'access', sub: ['import'] })}
        />
        <ActionRow
          id="passwords"
          title={t('prefs.sub.passwords')}
          navigation
          onActivate={() => go({ panel: 'access', sub: ['passwords'] })}
        />
        <ActionRow
          id="signOut"
          title={t('prefs.row.signOutSites')}
          subtitle={t('prefs.row.signOutSitesHint')}
          suffix={
            <button className="btn-danger" onClick={() => setSignOut(true)}>
              {t('prefs.button.signOut')}
            </button>
          }
        />
      </PreferencesGroup>
      {signOut && (
        <ConfirmDialog
          title={t('prefs.confirm.signOut')}
          body={t('prefs.confirm.signOutBody')}
          confirmLabel={t('prefs.button.signOut')}
          onConfirm={async () => {
            setSignOut(false)
            await window.api.browserSignOut()
            toast(t('prefs.toast.signedOut'), 'success')
          }}
          onCancel={() => setSignOut(false)}
        />
      )}
      <PreferencesGroup title={t('prefs.group.browserCookies')} description={t('settings.cookiesHint')}>
        <ComboRow
          id="cookies"
          title={t('prefs.row.cookiesFrom')}
          value={settings.cookiesFromBrowser}
          onChange={(v) => set('cookiesFromBrowser', v)}
          options={[
            { value: '', label: t('prefs.value.none') },
            // A saved choice stays listed, or the row could not show what is set.
            ...[...new Set([...cookieBrowsersFor(platform), ...(settings.cookiesFromBrowser ? [settings.cookiesFromBrowser] : [])])].map((b) => ({
              value: b,
              label: b.charAt(0).toUpperCase() + b.slice(1)
            }))
          ]}
        />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.cookiesFile')}>
        <ActionRow
          id="cookiesFile"
          title={t('prefs.sub.cookiesFile')}
          value={settings.cookiesFile ? baseName(settings.cookiesFile) : t('prefs.value.none')}
          navigation
          onActivate={() => go({ panel: 'access', sub: ['cookies-file'] })}
        />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.group.errorReports')}>
        {/* On or off, never "send by itself": on still asks every time. */}
        <SwitchRow
          id="errorReports"
          title={t('settings.errorReports')}
          subtitle={t('settings.errorReportsHint')}
          checked={settings.errorReports !== 'off'}
          onChange={(v) => set('errorReports', v ? 'ask' : 'off')}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

const browserName = (b: string): string => b.charAt(0).toUpperCase() + b.slice(1)

/**
 * Sign the built-in browser in from another one on this computer. The way into
 * Google, which turns embedded browsers away, and a shortcut into every other
 * site. Safari only exists on a Mac, so it is only offered there.
 */
export function ImportSignInsPage(): JSX.Element {
  const t = useT()
  const tp = useTp()
  const platform = useStore((s) => s.appInfo?.platform)
  const [busy, setBusy] = useState<string | null>(null)
  const browsers = SUPPORTED_COOKIE_BROWSERS.filter((b) => b !== 'safari' || platform === 'darwin')
  const run = async (browser: string): Promise<void> => {
    setBusy(browser)
    // A rejected call must not leave every Import button disabled and spinning.
    const result = await window.api
      .browserImportSignIns(browser)
      .catch((): SignInImport => ({ ok: false, why: 'failed' }))
      .finally(() => setBusy(null))
    const name = browserName(browser)
    if (result.ok) {
      toast(tp('prefs.toast.imported', result.sites, { browser: name }), 'success')
      return
    }
    const why = {
      notFound: t('prefs.import.notFound', { browser: name }),
      locked: t('prefs.import.locked', { browser: name }),
      encrypted: t('prefs.import.encrypted', { browser: name }),
      empty: t('prefs.import.empty', { browser: name }),
      failed: t('prefs.import.failed', { browser: name })
    }[result.why]
    toast(why, 'error')
  }
  return (
    <PreferencesPage>
      <PreferencesGroup description={t('prefs.importHint')}>
        {browsers.map((b) => (
          <ActionRow
            key={b}
            id={b}
            title={browserName(b)}
            suffix={
              <button className="btn-quiet" disabled={busy !== null} onClick={() => void run(b)}>
                {busy === b ? <Spinner /> : t('prefs.button.importSignIns')}
              </button>
            }
          />
        ))}
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/** Sites with saved passwords. The passwords themselves never reach this window. */
export function PasswordsPage(): JSX.Element {
  const t = useT()
  const [sites, setSites] = useState<SavedSiteLogins[] | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  // An empty list rather than a spinner for good, if the list cannot be read.
  const load = (): void => void window.api.browserLogins().then(setSites, () => setSites([]))
  useEffect(load, [])
  const forget = async (origin?: string): Promise<void> => {
    await window.api.browserForgetLogins(origin)
    load()
  }
  if (!sites) return <PreferencesPage><Spinner /></PreferencesPage>
  return (
    <PreferencesPage>
      <PreferencesGroup description={t('prefs.passwordsHint')}>
        {sites.length === 0 && <ActionRow id="none" title={t('prefs.passwordsNone')} />}
        {sites.map((s) => (
          <ActionRow
            key={s.origin}
            id={s.origin}
            title={s.origin.replace(/^https:\/\//, '')}
            subtitle={s.usernames.filter(Boolean).join(', ') || undefined}
            suffix={
              <button className="btn-quiet" onClick={() => void forget(s.origin)}>
                {t('common.remove')}
              </button>
            }
          />
        ))}
      </PreferencesGroup>
      {sites.length > 0 && (
        <PreferencesGroup>
          <ActionRow
            id="forgetAll"
            title={t('prefs.row.forgetPasswords')}
            suffix={
              <button className="btn-danger" onClick={() => setConfirmAll(true)}>
                {t('common.clear')}
              </button>
            }
          />
        </PreferencesGroup>
      )}
      {confirmAll && (
        <ConfirmDialog
          title={t('prefs.confirm.forgetPasswords')}
          body={t('prefs.confirm.forgetPasswordsBody')}
          confirmLabel={t('common.clear')}
          onConfirm={async () => {
            setConfirmAll(false)
            await forget()
          }}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </PreferencesPage>
  )
}

export function CookiesFilePage({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const choose = async (): Promise<void> => {
    const file = await window.api.chooseCookiesFile()
    if (file) set('cookiesFile', file)
  }
  return (
    <PreferencesPage>
      <PreferencesGroup description={t('settings.cookiesFileHint')}>
        <ActionRow
          id="file"
          title={t('prefs.row.currentFile')}
          subtitle={settings.cookiesFile || t('prefs.value.none')}
          monoSubtitle={Boolean(settings.cookiesFile)}
          suffix={
            <button className="btn-quiet" onClick={choose}>
              {t('prefs.button.chooseFile')}
            </button>
          }
        />
      </PreferencesGroup>
      {settings.cookiesFile && (
        <PreferencesGroup>
          <ActionRow
            id="clear"
            title={t('prefs.row.clearCookiesFile')}
            suffix={
              <button className="btn-danger" onClick={() => set('cookiesFile', '')}>
                {t('common.clear')}
              </button>
            }
          />
        </PreferencesGroup>
      )}
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- Network */

export function NetworkPanel({ settings, go }: PanelProps): JSX.Element {
  const t = useT()
  // Not `new URL`: it reads "localhost:8080" as a scheme with no host, and the row said Off.
  const host = settings.proxy ? parseProxy(settings.proxy).address : ''
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.group.proxy')}>
        <ActionRow
          id="proxy"
          title={t('prefs.sub.proxy')}
          value={host || t('prefs.value.off')}
          navigation
          onActivate={() => go({ panel: 'network', sub: ['proxy'] })}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

export function ProxyPage({ settings }: PanelProps): JSX.Element {
  const t = useT()
  const save = useStore((s) => s.saveSettings)
  // A deep link to the address or password opens the manual fields even before anything is set.
  const linked = useStore((s) => /#(address|password)$/.test(s.settingsRoute))
  const [manual, setManual] = useState(Boolean(settings.proxy) || linked)
  return (
    <PreferencesPage>
      <PreferencesGroup>
        <ActionRow
          id="method"
          title={t('prefs.row.proxyMethod')}
          suffix={
            <SegmentedControl
              label={t('prefs.row.proxyMethod')}
              value={manual ? 'manual' : 'off'}
              onChange={(v) => {
                setManual(v === 'manual')
                if (v === 'off' && settings.proxy) void save({ proxy: '' })
              }}
              options={[
                { value: 'off', label: t('prefs.value.off') },
                { value: 'manual', label: t('prefs.value.manual') }
              ]}
            />
          }
        />
      </PreferencesGroup>
      {manual && (
        <PreferencesGroup>
          <ProxyRows value={settings.proxy} onCommit={(v) => save({ proxy: v })} />
        </PreferencesGroup>
      )}
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- System */

export function SystemPanel({ go }: PanelProps): JSX.Element {
  const t = useT()
  const reset = useStore((s) => s.resetSettings)
  const [confirm, setConfirm] = useState(false)
  const nav = (sub: string, key: TranslationKey): ReactNode => (
    <ActionRow id={sub} title={t(key)} navigation onActivate={() => go({ panel: 'system', sub: [sub] })} />
  )
  return (
    <PreferencesPage>
      <PreferencesGroup>
        {nav('startup', 'prefs.sub.startup')}
        {nav('updates', 'prefs.sub.updates')}
        {nav('backup', 'prefs.sub.backup')}
        {nav('logs', 'prefs.sub.logs')}
        {nav('about', 'prefs.sub.about')}
      </PreferencesGroup>
      <PreferencesGroup>
        <ActionRow
          id="reset"
          title={<span className="text-bad">{t('prefs.row.reset')}</span>}
          label={t('prefs.row.reset')}
          onActivate={() => setConfirm(true)}
        />
      </PreferencesGroup>
      {confirm && (
        <ConfirmDialog
          title={t('settings.resetConfirm')}
          body={t('settings.resetConfirmBody')}
          confirmLabel={t('prefs.button.reset')}
          onConfirm={async () => {
            setConfirm(false)
            await reset()
            toast(t('settings.resetDone'), 'success')
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </PreferencesPage>
  )
}

export function StartupPage({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const row = (id: string, key: keyof AppSettings, label: TranslationKey, sub: TranslationKey): ReactNode => (
    <SwitchRow
      id={id}
      title={t(label)}
      subtitle={t(sub)}
      checked={Boolean(settings[key])}
      onChange={(v) => set(key, v as never)}
    />
  )
  return (
    <PreferencesPage>
      <PreferencesGroup>
        {row('autostart', 'autostart', 'settings.autostart', 'settings.autostartHint')}
        {row('notifications', 'notifications', 'settings.notifications', 'settings.notificationsHint')}
        {row('clipboard', 'clipboardWatch', 'settings.clipboardWatch', 'settings.clipboardWatchHint')}
        {/* Background watching keeps the icon and hides the window on close, whatever this switch said. */}
        <SwitchRow
          id="tray"
          title={t('settings.tray')}
          subtitle={t(settings.automationEnabled ? 'settings.trayImplied' : 'settings.trayHint')}
          checked={settings.trayEnabled || settings.automationEnabled}
          disabled={settings.automationEnabled}
          onChange={(v) => set('trayEnabled', v)}
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

export function UpdatesPage({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const update = useStore((s) => s.update)
  const ytdlp = useStore((s) => s.ytdlp)
  const proxy = useStore((s) => s.settings?.proxy)
  const [checking, setChecking] = useState(false)
  const [updatingEngine, setUpdatingEngine] = useState(false)
  const status =
    update.state === 'available'
      ? t('settings.updateAvailable', { version: update.version ?? '' })
      : update.state === 'error'
        ? updateErrorText(t, update.message)
        : update.state === 'not-available'
          ? t('settings.upToDate')
          : `${appInfo?.version ?? '—'}`
  return (
    <PreferencesPage>
      <PreferencesGroup>
        <SwitchRow
          id="autoUpdate"
          title={t('settings.autoUpdate')}
          subtitle={t('settings.autoUpdateHint')}
          checked={settings.autoUpdate}
          onChange={(v) => set('autoUpdate', v)}
        />
        <ActionRow
          id="check"
          title={t('prefs.row.checkUpdates')}
          subtitle={
            <span className="numeric" title={update.state === 'error' ? updateErrorDetail(update.message) : undefined}>
              {status}
            </span>
          }
          suffix={
            <button
              className="btn-quiet"
              disabled={checking}
              onClick={async () => {
                setChecking(true)
                try {
                  await window.api.checkForUpdates()
                } catch (err) {
                  toast(describeError(err), 'error')
                } finally {
                  setTimeout(() => setChecking(false), 1500)
                }
              }}
            >
              {checking && <Spinner />}
              {t('common.check')}
            </button>
          }
        />
        {appInfo?.manualUpdates && (
          <ActionRow
            id="manual"
            title={t('settings.manualUpdates')}
            subtitle={t('settings.manualUpdatesHint')}
            suffix={
              <button className="btn-quiet" onClick={() => window.api.openReleasesPage()}>
                {t('common.open')}
              </button>
            }
          />
        )}
        <ActionRow
          id="engine"
          title={t('settings.engine')}
          subtitle={
            // Main's status is in English; while there is no version, only a failure is worth a line.
            <span className="numeric" title={ytdlp.state === 'error' ? ytdlp.message : undefined}>
              {ytdlp.version
                ? `yt-dlp ${ytdlp.version}${ytdlp.refused ? ` · ${t('engine.refusedLabel')}` : ''}`
                : ytdlp.state === 'error'
                  ? engineFailureText(t, ytdlp.message, 'setup', proxy)
                  : 'yt-dlp'}
            </span>
          }
          suffix={
            <button
              className="btn-quiet"
              disabled={updatingEngine}
              onClick={async () => {
                setUpdatingEngine(true)
                try {
                  const res = await window.api.updateYtdlp()
                  if (res.ok) toast(t('settings.engineUpdated'), 'success')
                  // Main refuses to swap the binary out from under a running transfer.
                  else toast(res.code === 'engineBusy' ? t('err.engineBusy') : engineFailureText(t, res.error, 'update', proxy), 'error')
                } catch {
                  toast(t('settings.engineFailed'), 'error')
                } finally {
                  setUpdatingEngine(false)
                }
              }}
            >
              {updatingEngine && <Spinner />}
              {t('common.update')}
            </button>
          }
        />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/** Why a backup was refused, as a literal key per reason so the coverage test can find each one. */
const BACKUP_ERROR: Record<BackupError, TranslationKey> = {
  json: 'settings.backupErrJson',
  format: 'settings.backupErrFormat',
  version: 'settings.backupErrVersion',
  shape: 'settings.backupErrShape',
  read: 'settings.backupErrRead',
  write: 'settings.backupErrWrite'
}

/**
 * Export and import, with what the last import did written underneath: its
 * most important line (re-enter the passwords) is one people are still
 * reading while they go and do it, so it is not a toast.
 */
export function BackupPage(): JSX.Element {
  const t = useT()
  const importBackup = useStore((s) => s.importBackup)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [result, setResult] = useState<ImportCounts | null>(null)

  const exportNow = async (): Promise<void> => {
    setBusy('export')
    try {
      const outcome = await window.api.exportBackup()
      if (outcome.ok) toast(t('settings.backupExported', { watches: outcome.watches, targets: outcome.targets }), 'success')
      else if ('error' in outcome) toast(t(BACKUP_ERROR[outcome.error]), 'error')
    } catch {
      toast(t('settings.backupErrWrite'), 'error')
    } finally {
      setBusy(null)
    }
  }
  const importNow = async (): Promise<void> => {
    setBusy('import')
    try {
      const outcome = await importBackup()
      if (outcome.ok) {
        setResult(outcome.counts)
        toast(t('settings.backupImported'), 'success')
      } else if ('error' in outcome) toast(t(BACKUP_ERROR[outcome.error]), 'error')
    } catch {
      toast(t('settings.backupErrRead'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <PreferencesPage>
      <PreferencesGroup>
        <ActionRow
          id="export"
          title={t('settings.backupExport')}
          subtitle={t('settings.backupExportHint')}
          suffix={
            <button className="btn-quiet" onClick={exportNow} disabled={busy !== null}>
              {busy === 'export' && <Spinner />}
              {t('prefs.button.export')}
            </button>
          }
        />
        <ActionRow
          id="import"
          title={t('settings.backupImport')}
          subtitle={t('settings.backupImportHint')}
          suffix={
            <button className="btn-quiet" onClick={importNow} disabled={busy !== null}>
              {busy === 'import' && <Spinner />}
              {t('prefs.button.import')}
            </button>
          }
        />
      </PreferencesGroup>
      {result && (
        <div role="status" className="panel space-y-1 p-4 text-control text-ink">
          <p>{result.settings ? t('settings.backupResultSettings') : t('settings.backupResultSettingsSame')}</p>
          <p>{t('settings.backupResultWatches', { added: result.watchesAdded, skipped: result.watchesSkipped })}</p>
          {result.watchesInvalid > 0 && <p>{t('settings.backupResultInvalid', { n: result.watchesInvalid })}</p>}
          <p>{t('settings.backupResultTargets', { n: result.targetsAdded })}</p>
          {result.folderKept && <p>{t('settings.backupResultFolder')}</p>}
          <p className="pt-2 text-warn">{t('settings.backupSecrets')}</p>
          {result.proxyPassword && <p className="text-warn">{t('settings.backupResultProxy')}</p>}
        </div>
      )}
    </PreferencesPage>
  )
}

function CliRow(): JSX.Element | null {
  const t = useT()
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    let live = true
    window.api
      .cliStatus()
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  const row = describeCliCommand(status, t)
  if (!row) return null
  return (
    <ActionRow
      id="cli"
      title={t('settings.cli')}
      subtitle={row.hint}
      suffix={
        row.install && (
          <button
            className="btn-quiet"
            disabled={installing || row.disabled}
            onClick={async () => {
              setInstalling(true)
              try {
                const result = await window.api.cliInstall()
                setStatus(result.status)
                if (result.ok) toast(t('settings.cliInstallDone'), 'success')
                else if (!result.canceled) toast(t('settings.cliInstallFailed'), 'error')
              } catch {
                toast(t('settings.cliInstallFailed'), 'error')
              } finally {
                setInstalling(false)
              }
            }}
          >
            {installing && <Spinner />}
            {t('prefs.button.install')}
          </button>
        )
      }
    />
  )
}

export function LogsPage({ settings, set }: PanelProps): JSX.Element {
  const t = useT()
  return (
    <PreferencesPage>
      <PreferencesGroup>
        <SwitchRow
          id="verbose"
          title={t('settings.logVerbose')}
          subtitle={t('settings.logVerboseHint')}
          checked={settings.logVerbose}
          onChange={(v) => set('logVerbose', v)}
        />
        <ActionRow
          id="log"
          title={t('settings.logRow')}
          suffix={
            <button className="btn-quiet" onClick={async () => window.api.showInFolder(await window.api.getLogPath())}>
              {t('prefs.button.openLog')}
            </button>
          }
        />
        <CliRow />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/* ---------------------------------------------------------------- About (AdwAboutDialog layout) */

const REPO = 'https://github.com/DenisHumen/Universal-Video-Downloader'

function debugInfo(info: ReturnType<typeof useStore.getState>['appInfo'], engine: string | undefined): string {
  return [
    `Universal Video Downloader ${info?.version ?? '?'}`,
    `${info?.platform ?? '?'} ${info?.arch ?? '?'}`,
    `locale ${info?.locale ?? '?'}`,
    `yt-dlp ${engine ?? '?'}`,
    `manual updates ${info?.manualUpdates ? 'yes' : 'no'}`
  ].join('\n')
}

export function AboutPage({ go }: PanelProps): JSX.Element {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const engine = useStore((s) => s.ytdlp.version)
  return (
    <PreferencesPage>
      <div className="flex flex-col items-center pt-4 text-center">
        <span className="flex h-32 w-32 items-center justify-center rounded-4 bg-accent text-accent-fg shadow-[var(--shadow-2)]">
          <Logo className="h-20 w-20" />
        </span>
        <h2 className="mt-5 text-title-1 text-ink">Universal Video Downloader</h2>
        <p className="mt-1 text-body text-ink-2">Denis Humen</p>
        <button
          className="btn-quiet numeric mt-4 rounded-pill px-4 text-accent-ink"
          aria-label={t('prefs.about.copyVersion', { version: appInfo?.version ?? '' })}
          onClick={async () => {
            await navigator.clipboard?.writeText(debugInfo(appInfo, engine)).catch(() => undefined)
            toast(t('prefs.about.copied'), 'success')
          }}
        >
          {appInfo?.version ?? '—'}
        </button>
        <p className="mt-4 max-w-[48ch] text-meta text-ink-2">{t('settings.about')}</p>
      </div>
      <PreferencesGroup>
        <ActionRow id="website" title={t('prefs.about.website')} navigation onActivate={() => void window.api.openExternal(REPO)} />
        <ActionRow
          id="issue"
          title={t('prefs.about.report')}
          subtitle={t('prefs.about.reportHint')}
          navigation
          onActivate={() => void window.api.openExternal(`${REPO}/issues/new`)}
        />
        <ActionRow
          id="troubleshooting"
          title={t('prefs.sub.troubleshooting')}
          navigation
          onActivate={() => go({ panel: 'system', sub: ['about', 'troubleshooting'] })}
        />
      </PreferencesGroup>
      <PreferencesGroup>
        <ActionRow id="credits" title={t('prefs.sub.credits')} navigation onActivate={() => go({ panel: 'system', sub: ['about', 'credits'] })} />
        <ActionRow id="legal" title={t('prefs.sub.legal')} navigation onActivate={() => go({ panel: 'system', sub: ['about', 'legal'] })} />
      </PreferencesGroup>
    </PreferencesPage>
  )
}

export function TroubleshootingPage(): JSX.Element {
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)
  const engine = useStore((s) => s.ytdlp.version)
  const text = debugInfo(appInfo, engine)
  return (
    <PreferencesPage>
      <PreferencesGroup
        title={t('prefs.about.debugInfo')}
        suffix={
          <button
            className="btn-quiet"
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => undefined)
              toast(t('prefs.about.copied'), 'success')
            }}
          >
            {t('common.copy')}
          </button>
        }
      >
        <pre className="selectable whitespace-pre-wrap p-4 font-mono text-meta text-ink">{text}</pre>
      </PreferencesGroup>
    </PreferencesPage>
  )
}

const CREDITS: { name: string; role: TranslationKey; url: string }[] = [
  { name: 'yt-dlp', role: 'prefs.credits.engine', url: 'https://github.com/yt-dlp/yt-dlp' },
  { name: 'FFmpeg', role: 'prefs.credits.media', url: 'https://ffmpeg.org' },
  { name: 'Electron', role: 'prefs.credits.runtime', url: 'https://www.electronjs.org' },
  { name: 'React', role: 'prefs.credits.interface', url: 'https://react.dev' },
  { name: 'Ubuntu Sans', role: 'prefs.credits.font', url: 'https://github.com/canonical/Ubuntu-Sans-fonts' },
  { name: 'Yaru', role: 'prefs.credits.icons', url: 'https://github.com/ubuntu/yaru' }
]

export function CreditsPage(): JSX.Element {
  const t = useT()
  return (
    <PreferencesPage>
      <PreferencesGroup title={t('prefs.credits.developer')}>
        <ActionRow title="Denis Humen" navigation onActivate={() => void window.api.openExternal(REPO)} />
      </PreferencesGroup>
      <PreferencesGroup title={t('prefs.credits.builtWith')}>
        {CREDITS.map((c) => (
          <ActionRow key={c.name} title={c.name} subtitle={t(c.role)} navigation onActivate={() => void window.api.openExternal(c.url)} />
        ))}
      </PreferencesGroup>
    </PreferencesPage>
  )
}

/** The licence texts, loaded when the page opens: they are long and nothing else needs them. */
function useLicence(load: () => Promise<{ default: string }>): string {
  const [text, setText] = useState('')
  useEffect(() => {
    let live = true
    void load().then((m) => live && setText(m.default))
    return () => {
      live = false
    }
  }, [load])
  return text
}
const loadUfl = (): Promise<{ default: string }> => import('../../assets/fonts/UFL-1.0.txt?raw')
const loadCc = (): Promise<{ default: string }> => import('../../../../../resources/icons/yaru/LICENSE-CC-BY-SA-4.0.txt?raw')

function Licence({ id, title, summary, text }: { id: string; title: string; summary: ReactNode; text?: string }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <PreferencesGroup title={title} id={id}>
      <div className="space-y-2 p-4 text-control text-ink">{summary}</div>
      {text !== undefined && (
        <div className="border-t border-edge-soft">
          <button className="ui-row ui-row-activatable" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="ui-row-title flex-1">{open ? t('prefs.legal.hideText') : t('prefs.legal.showText')}</span>
          </button>
          {open && <pre className="selectable max-h-80 overflow-auto whitespace-pre-wrap px-4 pb-4 font-mono text-caption text-ink-2">{text}</pre>}
        </div>
      )}
    </PreferencesGroup>
  )
}

export function LegalPage(): JSX.Element {
  const t = useT()
  const ufl = useLicence(loadUfl)
  const cc = useLicence(loadCc)
  return (
    <PreferencesPage>
      <Licence
        id="app"
        title="Universal Video Downloader"
        summary={<p>{t('prefs.legal.app')}</p>}
      />
      <Licence
        id="font"
        title="Ubuntu Sans, Ubuntu Sans Mono"
        summary={
          <>
            <p>{t('prefs.legal.font')}</p>
            <p className="text-ink-2">{t('prefs.legal.trademark')}</p>
          </>
        }
        text={ufl}
      />
      <Licence id="icons" title={t('prefs.legal.iconsTitle')} summary={<p>{t('prefs.legal.icons')}</p>} text={cc} />
      <Licence id="engine" title="yt-dlp" summary={<p>{t('prefs.legal.ytdlp')}</p>} />
      <Licence id="ffmpeg" title="FFmpeg" summary={<p>{t('prefs.legal.ffmpeg')}</p>} />
      <p className="px-1 text-meta text-ink-2">{t('prefs.legal.notices')}</p>
    </PreferencesPage>
  )
}

/** The page for a route: the panel, or its deepest subpage. */
export function pageFor(route: Route, props: PanelProps): ReactNode {
  const path = formatRoute({ ...route, row: undefined })
  switch (path) {
    case 'appearance':
      return <AppearancePanel {...props} />
    case 'downloads':
      return <DownloadsPanel {...props} />
    case 'processing':
      return <ProcessingPanel {...props} />
    case 'watching':
      return <WatchingPanel {...props} />
    case 'watching/shares':
      return <SharesPage />
    case 'watching/telegram':
      return <TelegramPage />
    case 'detection':
      return <DetectionPanel {...props} />
    case 'access':
      return <AccessPanel {...props} />
    case 'access/cookies-file':
      return <CookiesFilePage {...props} />
    case 'access/passwords':
      return <PasswordsPage />
    case 'access/import':
      return <ImportSignInsPage />
    case 'network':
      return <NetworkPanel {...props} />
    case 'network/proxy':
      return <ProxyPage {...props} />
    case 'system':
      return <SystemPanel {...props} />
    case 'system/startup':
      return <StartupPage {...props} />
    case 'system/updates':
      return <UpdatesPage {...props} />
    case 'system/backup':
      return <BackupPage />
    case 'system/logs':
      return <LogsPage {...props} />
    case 'system/about':
      return <AboutPage {...props} />
    case 'system/about/troubleshooting':
      return <TroubleshootingPage />
    case 'system/about/credits':
      return <CreditsPage />
    case 'system/about/legal':
      return <LegalPage />
    default:
      return <AppearancePanel {...props} />
  }
}
