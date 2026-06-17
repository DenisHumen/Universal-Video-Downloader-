import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Folder, Github, Loader2, RefreshCw } from 'lucide-react'
import {
  SUPPORTED_COOKIE_BROWSERS,
  type AppSettings,
  type DownloadMode,
  type QualityPreset
} from '@shared/types'
import { useStore } from '../store'
import Segmented from '../components/Segmented'

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
        {hint && <p className="mono mt-0.5 truncate text-xs text-white/35">{hint}</p>}
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
      {hint && <p className="mono mt-1.5 text-[11px] text-white/30">{hint}</p>}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-cream' : 'bg-white/10'}`}
    >
      <motion.span
        className={`absolute top-0.5 h-5 w-5 rounded-full ${value ? 'bg-ink-950' : 'bg-white/70'}`}
        animate={{ left: value ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

export default function SettingsView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const appInfo = useStore((s) => s.appInfo)
  const ytdlp = useStore((s) => s.ytdlp)
  const update = useStore((s) => s.update)
  const save = useStore((s) => s.saveSettings)

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

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-8 py-9">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-cream">settings</h1>

      <Section title="downloads">
        <Row label="save location" hint={settings.downloadDir}>
          <button className="btn-ghost" onClick={chooseFolder}>
            <Folder size={15} /> change
          </button>
        </Row>
        <Field label="default mode">
          <Segmented
            layoutId="set-mode"
            value={settings.defaultMode}
            onChange={(v) => set('defaultMode', v as DownloadMode)}
            options={[
              { value: 'video', label: 'video' },
              { value: 'audio', label: 'audio only' }
            ]}
          />
        </Field>
        <Field label="default quality">
          <Segmented
            layoutId="set-quality"
            value={settings.defaultQuality}
            onChange={(v) => set('defaultQuality', v as QualityPreset)}
            options={[
              { value: 'best', label: 'best' },
              { value: '2160', label: '4K' },
              { value: '1080', label: '1080p' },
              { value: '720', label: '720p' },
              { value: 'audio', label: 'audio' }
            ]}
          />
        </Field>
        <Field label="audio format" hint="used for audio-only downloads">
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
        <Field label="simultaneous downloads">
          <Segmented
            layoutId="set-concurrent"
            value={String(settings.concurrentDownloads)}
            onChange={(v) => set('concurrentDownloads', Number(v))}
            options={['1', '2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
          />
        </Field>
      </Section>

      <Section title="post-processing">
        <Row label="embed thumbnail" hint="adds cover art to the file">
          <Toggle value={settings.embedThumbnail} onChange={(v) => set('embedThumbnail', v)} />
        </Row>
        <Row label="embed metadata" hint="title, author, description">
          <Toggle value={settings.embedMetadata} onChange={(v) => set('embedMetadata', v)} />
        </Row>
        <Row label="embed subtitles" hint="where available">
          <Toggle value={settings.embedSubtitles} onChange={(v) => set('embedSubtitles', v)} />
        </Row>
        <Row label="restrict filenames" hint="ascii-only, no spaces">
          <Toggle value={settings.restrictFilenames} onChange={(v) => set('restrictFilenames', v)} />
        </Row>
      </Section>

      <Section title="access & cookies">
        <Field
          label="use cookies from browser"
          hint="many sites (including adult sites) gate videos behind an age or login check — point the app at a browser where you're signed in to get past it. close that browser while downloading."
        >
          <Segmented
            layoutId="set-cookies"
            fill={false}
            value={settings.cookiesFromBrowser}
            onChange={(v) => set('cookiesFromBrowser', v)}
            options={[
              { value: '', label: 'off' },
              ...SUPPORTED_COOKIE_BROWSERS.map((b) => ({ value: b, label: b }))
            ]}
          />
        </Field>
      </Section>

      <Section title="network">
        <Field label="proxy">
          <input
            value={settings.proxy}
            onChange={(e) => set('proxy', e.target.value)}
            placeholder="http://host:port (optional)"
            className="input"
            spellCheck={false}
          />
        </Field>
        <Field label="filename template" hint="yt-dlp output template">
          <input
            value={settings.filenameTemplate}
            onChange={(e) => set('filenameTemplate', e.target.value)}
            className="input mono text-xs"
            spellCheck={false}
          />
        </Field>
      </Section>

      <Section title="updates">
        <Row label="automatic app updates" hint="check on launch and notify">
          <Toggle value={settings.autoUpdate} onChange={(v) => set('autoUpdate', v)} />
        </Row>
        <Row
          label="app version"
          hint={
            update.state === 'available'
              ? `update ${update.version} available`
              : update.state === 'not-available'
                ? 'you are up to date'
                : `v${appInfo?.version ?? '—'}`
          }
        >
          <button className="btn-ghost" onClick={checkUpdates} disabled={checking}>
            {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            check
          </button>
        </Row>
        <Row label="download engine" hint={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || 'yt-dlp'}>
          <button className="btn-ghost" onClick={updateEngine} disabled={updatingEngine}>
            {updatingEngine ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            update
          </button>
        </Row>
      </Section>

      <Section title="about">
        <p className="text-xs leading-relaxed text-white/40">
          powered by the open-source{' '}
          <button
            className="text-cream hover:underline"
            onClick={() => window.api.openExternal('https://github.com/yt-dlp/yt-dlp')}
          >
            yt-dlp
          </button>{' '}
          engine and ffmpeg. please respect the terms of service and copyright of the sites you
          download from.
        </p>
        <button
          className="btn-ghost"
          onClick={() => window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')}
        >
          <Github size={15} /> view on github
        </button>
      </Section>

      <p className="mono pb-4 text-center text-[11px] text-white/25">
        {appInfo?.platform} · {appInfo?.arch}
      </p>
    </div>
  )
}
