import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { pill } from '../lib/motion'
import {
  Cookie,
  Folder,
  Github,
  Info,
  Loader2,
  MonitorCog,
  Network,
  Palette,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sliders,
  Wand2
} from 'lucide-react'
import {
  ACCENTS,
  SUPPORTED_COOKIE_BROWSERS,
  THEMES,
  type AccentId,
  type AppSettings,
  type DownloadMode,
  type LanguageId,
  type QualityPreset,
  type ThemeId
} from '@shared/types'
import { useStore } from '../store'
import { LANGUAGES, useT, type TranslationKey } from '../i18n'
import { toast } from '../lib/toast'
import Segmented from '../components/Segmented'

type SectionId =
  | 'appearance'
  | 'downloads'
  | 'processing'
  | 'detection'
  | 'access'
  | 'network'
  | 'system'
  | 'updates'
  | 'about'

const SECTIONS: { id: SectionId; label: TranslationKey; icon: JSX.Element }[] = [
  { id: 'appearance', label: 'settings.section.appearance', icon: <Palette size={16} /> },
  { id: 'downloads', label: 'settings.section.downloads', icon: <Sliders size={16} /> },
  { id: 'processing', label: 'settings.section.processing', icon: <Wand2 size={16} /> },
  { id: 'detection', label: 'settings.section.detection', icon: <Sparkles size={16} /> },
  { id: 'access', label: 'settings.section.access', icon: <Cookie size={16} /> },
  { id: 'network', label: 'settings.section.network', icon: <Network size={16} /> },
  { id: 'system', label: 'settings.section.system', icon: <MonitorCog size={16} /> },
  { id: 'updates', label: 'settings.section.updates', icon: <RefreshCw size={16} /> },
  { id: 'about', label: 'settings.section.about', icon: <Info size={16} /> }
]

const THEME_LABEL: Record<ThemeId, TranslationKey> = {
  midnight: 'settings.theme.midnight',
  carbon: 'settings.theme.carbon',
  nebula: 'settings.theme.nebula',
  daylight: 'settings.theme.daylight'
}

const ACCENT_SWATCH: Record<AccentId, string> = {
  indigo: '#5e6ad2',
  violet: '#7052f0',
  cyan: '#2dd4e9',
  emerald: '#22c55e',
  amber: '#fbbf24',
  rose: '#e11d48',
  cream: '#ededef'
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

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="card p-5">
      <p className="group-title">{title}</p>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-cream">{label}</p>
        {hint && <p className="mono mt-0.5 truncate text-xs text-fg/50">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <p className="mb-2 text-sm text-cream">{label}</p>
      {children}
      {hint && <p className="mono mt-1.5 text-[11px] leading-relaxed text-fg/50">{hint}</p>}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-fg/10'}`}
    >
      <motion.span
        className={`absolute top-0.5 h-5 w-5 rounded-full ${value ? 'bg-accent-fg' : 'bg-fg/70'}`}
        animate={{ left: value ? 22 : 2 }}
        transition={pill}
      />
    </button>
  )
}

export default function SettingsView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const ytdlp = useStore((s) => s.ytdlp)
  const update = useStore((s) => s.update)
  const save = useStore((s) => s.saveSettings)
  const reset = useStore((s) => s.resetSettings)

  const [section, setSection] = useState<SectionId>('appearance')
  const [checking, setChecking] = useState(false)
  const [updatingEngine, setUpdatingEngine] = useState(false)

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
    await window.api.updateYtdlp()
    setUpdatingEngine(false)
  }
  const resetAll = async (): Promise<void> => {
    await reset()
    toast(t('settings.resetDone'), 'success')
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[186px] shrink-0 flex-col border-r border-fg/[0.06]">
        <p className="group-title mb-2 px-4 pt-6">{t('settings.title')}</p>
        <div className="flex-1 space-y-1 overflow-y-auto px-2.5 pb-4">
          {SECTIONS.map((s) => {
            const isActive = s.id === section
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className="no-drag group relative flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left"
              >
                {isActive && (
                  <motion.span
                    layoutId="settings-section-active"
                    className="absolute inset-0 rounded-2xl bg-accent"
                    transition={pill}
                  />
                )}
                <span
                  className={`relative z-10 transition-colors ${
                    isActive ? 'text-accent-fg' : 'text-fg/60 group-hover:text-cream'
                  }`}
                >
                  {s.icon}
                </span>
                <span
                  className={`relative z-10 text-[13px] font-medium transition-colors ${
                    isActive ? 'text-accent-fg' : 'text-fg/70 group-hover:text-cream'
                  }`}
                >
                  {t(s.label)}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-auto w-full max-w-xl space-y-4 px-7 py-8"
        >
          {section === 'appearance' && (
            <Section title={t('settings.section.appearance')}>
              <Field label={t('settings.language')}>
                <Segmented
                  layoutId="set-language"
                  value={settings.language}
                  onChange={(v) => set('language', v as LanguageId)}
                  options={LANGUAGES.map((l) => ({
                    value: l.id,
                    label: l.id === 'auto' ? t('settings.language.auto') : l.label
                  }))}
                />
              </Field>
              <Field label={t('settings.theme')}>
                <Segmented
                  layoutId="set-theme"
                  value={settings.theme}
                  onChange={(v) => set('theme', v as ThemeId)}
                  options={THEMES.map((id) => ({ value: id, label: t(THEME_LABEL[id]) }))}
                />
              </Field>
              <Field label={t('settings.accent')}>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((accent) => {
                    const isActive = settings.accent === accent
                    return (
                      <button
                        key={accent}
                        onClick={() => set('accent', accent)}
                        aria-label={accent}
                        title={accent}
                        className={`relative h-9 w-9 rounded-2xl border transition-all ${
                          isActive
                            ? 'border-accent scale-105 shadow-glow'
                            : 'border-fg/[0.08] hover:border-fg/25'
                        }`}
                      >
                        <span
                          className="absolute inset-1.5 rounded-xl"
                          style={{ background: ACCENT_SWATCH[accent] }}
                        />
                      </button>
                    )
                  })}
                </div>
              </Field>
            </Section>
          )}

          {section === 'downloads' && (
            <Section title={t('settings.section.downloads')}>
              <Row label={t('settings.saveLocation')} hint={settings.downloadDir}>
                <button className="btn-ghost" onClick={chooseFolder}>
                  <Folder size={15} /> {t('common.change')}
                </button>
              </Row>
              <Row label={t('settings.subfolders')} hint={t('settings.subfoldersHint')}>
                <Toggle value={settings.createSubfolders} onChange={(v) => set('createSubfolders', v)} />
              </Row>
              <Field label={t('settings.defaultMode')}>
                <Segmented
                  layoutId="set-mode"
                  value={settings.defaultMode}
                  onChange={(v) => set('defaultMode', v as DownloadMode)}
                  options={[
                    { value: 'video', label: t('common.video') },
                    { value: 'audio', label: t('common.audioOnly') }
                  ]}
                />
              </Field>
              <Field label={t('settings.defaultQuality')} hint={t('settings.defaultQualityHint')}>
                <Segmented
                  layoutId="set-quality"
                  value={settings.defaultQuality === 'audio' ? 'best' : settings.defaultQuality}
                  onChange={(v) => set('defaultQuality', v as QualityPreset)}
                  options={QUALITY_OPTIONS.map((q) => ({
                    value: q.value,
                    label: q.value === 'best' ? t('common.best') : q.label
                  }))}
                />
              </Field>
              <Field label={t('settings.audioFormat')} hint={t('settings.audioFormatHint')}>
                <Segmented
                  layoutId="set-audio"
                  value={settings.audioFormat}
                  onChange={(v) => set('audioFormat', v)}
                  options={['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'].map((f) => ({
                    value: f,
                    label: <span className="uppercase">{f}</span>
                  }))}
                />
              </Field>
              <Field label={t('settings.concurrent')}>
                <Segmented
                  layoutId="set-concurrent"
                  value={String(settings.concurrentDownloads)}
                  onChange={(v) => set('concurrentDownloads', Number(v))}
                  options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
                />
              </Field>
              <Field label={t('settings.speedLimit')} hint={t('settings.speedLimitHint')}>
                <input
                  value={settings.speedLimit}
                  onChange={(e) => set('speedLimit', e.target.value)}
                  placeholder="2M"
                  className="input mono text-xs"
                  spellCheck={false}
                />
              </Field>
              <Field label={t('settings.playlistLimit')} hint={t('settings.playlistLimitHint')}>
                <Segmented
                  layoutId="set-playlist-limit"
                  value={String(settings.playlistLimit)}
                  onChange={(v) => set('playlistLimit', Number(v))}
                  options={['50', '200', '500', '1000', '5000'].map((n) => ({ value: n, label: n }))}
                />
              </Field>
            </Section>
          )}

          {section === 'processing' && (
            <Section title={t('settings.section.processing')}>
              <Row label={t('settings.embedThumbnail')} hint={t('settings.embedThumbnailHint')}>
                <Toggle value={settings.embedThumbnail} onChange={(v) => set('embedThumbnail', v)} />
              </Row>
              <Row label={t('settings.embedMetadata')} hint={t('settings.embedMetadataHint')}>
                <Toggle value={settings.embedMetadata} onChange={(v) => set('embedMetadata', v)} />
              </Row>
              <Row label={t('settings.embedChapters')} hint={t('settings.embedChaptersHint')}>
                <Toggle value={settings.embedChapters} onChange={(v) => set('embedChapters', v)} />
              </Row>
              <Row label={t('settings.embedSubtitles')} hint={t('settings.embedSubtitlesHint')}>
                <Toggle value={settings.embedSubtitles} onChange={(v) => set('embedSubtitles', v)} />
              </Row>
              <Row label={t('settings.writeSubtitles')} hint={t('settings.writeSubtitlesHint')}>
                <Toggle value={settings.writeSubtitles} onChange={(v) => set('writeSubtitles', v)} />
              </Row>
              <Field label={t('settings.subtitleLanguages')} hint={t('settings.subtitleLanguagesHint')}>
                <input
                  value={settings.subtitleLanguages}
                  onChange={(e) => set('subtitleLanguages', e.target.value)}
                  placeholder="en,ru"
                  className="input mono text-xs"
                  spellCheck={false}
                />
              </Field>
              <Row label={t('settings.sponsorBlock')} hint={t('settings.sponsorBlockHint')}>
                <Toggle value={settings.sponsorBlock} onChange={(v) => set('sponsorBlock', v)} />
              </Row>
              <Row label={t('settings.restrictFilenames')} hint={t('settings.restrictFilenamesHint')}>
                <Toggle value={settings.restrictFilenames} onChange={(v) => set('restrictFilenames', v)} />
              </Row>
              <Field label={t('settings.filenameTemplate')} hint={t('settings.filenameTemplateHint')}>
                <input
                  value={settings.filenameTemplate}
                  onChange={(e) => set('filenameTemplate', e.target.value)}
                  className="input mono text-xs"
                  spellCheck={false}
                />
              </Field>
            </Section>
          )}

          {section === 'detection' && (
            <Section title={t('settings.section.detection')}>
              <Row label={t('settings.universal')} hint={undefined}>
                <Toggle value={settings.universalFallback} onChange={(v) => set('universalFallback', v)} />
              </Row>
              <p className="text-xs leading-relaxed text-fg/55">{t('settings.universalHint')}</p>
            </Section>
          )}

          {section === 'access' && (
            <Section title={t('settings.section.access')}>
              <Field label={t('settings.cookies')} hint={t('settings.cookiesHint')}>
                <Segmented
                  layoutId="set-cookies"
                  fill={false}
                  value={settings.cookiesFromBrowser}
                  onChange={(v) => set('cookiesFromBrowser', v)}
                  options={[
                    { value: '', label: t('common.off') },
                    ...SUPPORTED_COOKIE_BROWSERS.map((b) => ({ value: b, label: b }))
                  ]}
                />
              </Field>
              <Row
                label={t('settings.cookiesFile')}
                hint={settings.cookiesFile || t('settings.cookiesFileHint')}
              >
                <div className="flex items-center gap-2">
                  {settings.cookiesFile && (
                    <button className="btn-ghost px-3 py-2 text-xs" onClick={() => set('cookiesFile', '')}>
                      {t('settings.cookiesFileClear')}
                    </button>
                  )}
                  <button className="btn-ghost" onClick={chooseCookies}>
                    <Folder size={15} /> {t('settings.cookiesFileChoose')}
                  </button>
                </div>
              </Row>
            </Section>
          )}

          {section === 'network' && (
            <Section title={t('settings.section.network')}>
              <Field label={t('settings.proxy')}>
                <input
                  value={settings.proxy}
                  onChange={(e) => set('proxy', e.target.value)}
                  placeholder={t('settings.proxyPlaceholder')}
                  className="input"
                  spellCheck={false}
                />
              </Field>
            </Section>
          )}

          {section === 'system' && (
            <Section title={t('settings.section.system')}>
              <Row label={t('settings.notifications')} hint={t('settings.notificationsHint')}>
                <Toggle value={settings.notifications} onChange={(v) => set('notifications', v)} />
              </Row>
              <Row label={t('settings.clipboardWatch')} hint={t('settings.clipboardWatchHint')}>
                <Toggle value={settings.clipboardWatch} onChange={(v) => set('clipboardWatch', v)} />
              </Row>
              <Row label={t('settings.tray')} hint={t('settings.trayHint')}>
                <Toggle value={settings.trayEnabled} onChange={(v) => set('trayEnabled', v)} />
              </Row>
              <div className="pt-1">
                <button className="btn-danger w-full" onClick={resetAll}>
                  <RotateCcw size={15} /> {t('settings.reset')}
                </button>
              </div>
            </Section>
          )}

          {section === 'updates' && (
            <Section title={t('settings.section.updates')}>
              <Row label={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
                <Toggle value={settings.autoUpdate} onChange={(v) => set('autoUpdate', v)} />
              </Row>
              <Row
                label={t('settings.appVersion')}
                hint={
                  update.state === 'available'
                    ? t('settings.updateAvailable', { version: update.version ?? '' })
                    : update.state === 'not-available'
                      ? t('settings.upToDate')
                      : `v${appInfo?.version ?? '—'}`
                }
              >
                <button className="btn-ghost" onClick={checkUpdates} disabled={checking}>
                  {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  {t('common.check')}
                </button>
              </Row>
              {appInfo?.manualUpdates && (
                <Row label={t('settings.manualUpdates')} hint={t('settings.manualUpdatesHint')}>
                  <button className="btn-ghost" onClick={() => window.api.openReleasesPage()}>
                    {t('common.open')}
                  </button>
                </Row>
              )}
              <Row
                label={t('settings.engine')}
                hint={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || 'yt-dlp'}
              >
                <button className="btn-ghost" onClick={updateEngine} disabled={updatingEngine}>
                  {updatingEngine ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t('common.update')}
                </button>
              </Row>
            </Section>
          )}

          {section === 'about' && (
            <Section title={t('settings.section.about')}>
              <p className="text-xs leading-relaxed text-fg/55">{t('settings.about')}</p>
              <button
                className="btn-ghost"
                onClick={() =>
                  window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
                }
              >
                <Github size={15} /> {t('settings.viewOnGithub')}
              </button>
              <p className="mono text-center text-[11px] text-fg/55">
                v{appInfo?.version} · {appInfo?.platform} · {appInfo?.arch}
              </p>
            </Section>
          )}
        </motion.div>
      </div>
    </div>
  )
}
