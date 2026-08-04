import { useEffect, useRef, useState, type ReactNode } from 'react'
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

const SECTIONS: { id: SectionId; label: TranslationKey }[] = [
  { id: 'appearance', label: 'settings.section.appearance' },
  { id: 'downloads', label: 'settings.section.downloads' },
  { id: 'processing', label: 'settings.section.processing' },
  { id: 'detection', label: 'settings.section.detection' },
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
function Row({
  label,
  hint,
  children,
  stack = false
}: {
  label: string
  hint?: string
  children: ReactNode
  stack?: boolean
}): JSX.Element {
  return (
    <div
      className={`flex gap-x-6 gap-y-3 border-b border-edge py-4 ${
        stack ? 'flex-col' : 'flex-wrap items-center justify-between'
      }`}
    >
      <div className="min-w-0 max-w-md">
        <p className="text-[14px] text-ink">{label}</p>
        {hint && <p className="hint mt-1">{hint}</p>}
      </div>
      <div className={stack ? '' : 'shrink-0'}>{children}</div>
    </div>
  )
}

/**
 * A switch, not a pill with a floating knob: a track that fills with the accent
 * and a knob that slides on a CSS transition rather than a spring, because a
 * binary control has nothing to be springy about.
 */
function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
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

  const jump = (id: SectionId): void => {
    const target = scrollRef.current?.querySelector(`#set-${id}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    await window.api.updateYtdlp()
    setUpdatingEngine(false)
  }
  const resetAll = async (): Promise<void> => {
    await reset()
    toast(t('settings.resetDone'), 'success')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pt-10">
        <h1 className="h1">{t('settings.title')}</h1>
        {/*
          An underline strip, not a pill row.
          The index was styled with `.choice` at first, which is the app's
          *selection* control — so the section index looked exactly like the
          radio groups it scrolls to, and nothing said which one changed a
          setting and which one just moved the page.
        */}
        <nav className="mt-4 flex gap-0.5 overflow-x-auto border-b border-edge" aria-label={t('settings.title')}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => jump(s.id)}
              aria-current={active === s.id ? 'true' : undefined}
              className={`tab -mb-px shrink-0 ${active === s.id ? 'tab-on' : ''}`}
            >
              {t(s.label)}
            </button>
          ))}
        </nav>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-24">
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
            <Row label={t('settings.saveLocation')} hint={settings.downloadDir}>
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
            <Row label={t('settings.speedLimit')} hint={t('settings.speedLimitHint')}>
              <input
                value={settings.speedLimit}
                onChange={(e) => set('speedLimit', e.target.value)}
                placeholder="2M"
                className="field mono w-36 text-[13px]"
                spellCheck={false}
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
              <input
                value={settings.subtitleLanguages}
                onChange={(e) => set('subtitleLanguages', e.target.value)}
                placeholder="en,ru"
                className="field mono w-44 text-[13px]"
                spellCheck={false}
              />
            </Row>
            <Row label={t('settings.sponsorBlock')} hint={t('settings.sponsorBlockHint')}>
              <Switch value={settings.sponsorBlock} onChange={(v) => set('sponsorBlock', v)} />
            </Row>
            <Row label={t('settings.restrictFilenames')} hint={t('settings.restrictFilenamesHint')}>
              <Switch value={settings.restrictFilenames} onChange={(v) => set('restrictFilenames', v)} />
            </Row>
            <Row label={t('settings.filenameTemplate')} hint={t('settings.filenameTemplateHint')} stack>
              <input
                value={settings.filenameTemplate}
                onChange={(e) => set('filenameTemplate', e.target.value)}
                className="field mono text-[13px]"
                spellCheck={false}
              />
            </Row>
          </Group>

          <Group id="detection" title={t('settings.section.detection')}>
            <Row label={t('settings.universal')} hint={t('settings.universalHint')}>
              <Switch value={settings.universalFallback} onChange={(v) => set('universalFallback', v)} />
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
            <Row label={t('settings.proxy')} stack>
              <input
                value={settings.proxy}
                onChange={(e) => set('proxy', e.target.value)}
                placeholder={t('settings.proxyPlaceholder')}
                className="field mono text-[13px]"
                spellCheck={false}
              />
            </Row>
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
            <Row label={t('settings.reset')}>
              <button className="btn-danger" onClick={resetAll}>
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
    </div>
  )
}
