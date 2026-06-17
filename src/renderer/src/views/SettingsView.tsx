import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Folder,
  Github,
  Loader2,
  RefreshCw,
  Sparkles,
  Cpu,
  Info
} from 'lucide-react'
import type { AppSettings, DownloadMode, QualityPreset } from '@shared/types'
import { useStore } from '../store'

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/80">
        <span className="text-accent-300">{icon}</span>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white/80">{label}</p>
        {hint && <p className="text-xs text-white/35">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 rounded-full transition-colors ${value ? 'bg-accent-500' : 'bg-white/10'}`}
    >
      <motion.span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
        animate={{ left: value ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

const QUALITIES: { q: QualityPreset; label: string }[] = [
  { q: 'best', label: 'Best' },
  { q: '2160', label: '4K' },
  { q: '1080', label: '1080p' },
  { q: '720', label: '720p' },
  { q: 'audio', label: 'Audio' }
]

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
    <div className="mx-auto w-full max-w-2xl space-y-5 px-8 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>

      <Section title="Downloads" icon={<Folder size={16} />}>
        <Row label="Save location" hint={settings.downloadDir}>
          <button className="btn-ghost" onClick={chooseFolder}>
            <Folder size={15} /> Change
          </button>
        </Row>
        <Row label="Default mode">
          <div className="flex rounded-lg bg-base-900/60 p-0.5">
            {(['video', 'audio'] as DownloadMode[]).map((m) => (
              <button
                key={m}
                onClick={() => set('defaultMode', m)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  settings.defaultMode === m ? 'bg-accent-500 text-white' : 'text-white/50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Default quality">
          <select
            value={settings.defaultQuality}
            onChange={(e) => set('defaultQuality', e.target.value as QualityPreset)}
            className="input w-32 cursor-pointer py-2"
          >
            {QUALITIES.map((q) => (
              <option key={q.q} value={q.q} className="bg-base-800">
                {q.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Audio format" hint="Used for audio-only downloads">
          <select
            value={settings.audioFormat}
            onChange={(e) => set('audioFormat', e.target.value)}
            className="input w-32 cursor-pointer py-2 uppercase"
          >
            {['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac'].map((f) => (
              <option key={f} value={f} className="bg-base-800">
                {f}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Simultaneous downloads" hint={`${settings.concurrentDownloads} at a time`}>
          <input
            type="range"
            min={1}
            max={6}
            value={settings.concurrentDownloads}
            onChange={(e) => set('concurrentDownloads', Number(e.target.value))}
            className="w-36"
          />
        </Row>
      </Section>

      <Section title="Post-processing" icon={<Sparkles size={16} />}>
        <Row label="Embed thumbnail" hint="Adds cover art to the file">
          <Toggle value={settings.embedThumbnail} onChange={(v) => set('embedThumbnail', v)} />
        </Row>
        <Row label="Embed metadata" hint="Title, author, description">
          <Toggle value={settings.embedMetadata} onChange={(v) => set('embedMetadata', v)} />
        </Row>
        <Row label="Embed subtitles" hint="Where available">
          <Toggle value={settings.embedSubtitles} onChange={(v) => set('embedSubtitles', v)} />
        </Row>
        <Row label="Restrict filenames" hint="ASCII-only, no spaces">
          <Toggle value={settings.restrictFilenames} onChange={(v) => set('restrictFilenames', v)} />
        </Row>
      </Section>

      <Section title="Network" icon={<Cpu size={16} />}>
        <div>
          <p className="mb-1.5 text-sm text-white/80">Proxy</p>
          <input
            value={settings.proxy}
            onChange={(e) => set('proxy', e.target.value)}
            placeholder="http://host:port (optional)"
            className="input"
            spellCheck={false}
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm text-white/80">Filename template</p>
          <input
            value={settings.filenameTemplate}
            onChange={(e) => set('filenameTemplate', e.target.value)}
            className="input font-mono text-xs"
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-white/30">
            yt-dlp output template, e.g. %(title)s [%(id)s].%(ext)s
          </p>
        </div>
      </Section>

      <Section title="Updates" icon={<RefreshCw size={16} />}>
        <Row label="Automatic app updates" hint="Check on launch and notify">
          <Toggle value={settings.autoUpdate} onChange={(v) => set('autoUpdate', v)} />
        </Row>
        <Row
          label="App version"
          hint={
            update.state === 'available'
              ? `Update ${update.version} available`
              : update.state === 'not-available'
                ? 'You are up to date'
                : `v${appInfo?.version ?? '—'}`
          }
        >
          <button className="btn-ghost" onClick={checkUpdates} disabled={checking}>
            {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Check
          </button>
        </Row>
        <Row
          label="Download engine"
          hint={ytdlp.version ? `yt-dlp ${ytdlp.version}` : ytdlp.message || 'yt-dlp'}
        >
          <button className="btn-ghost" onClick={updateEngine} disabled={updatingEngine}>
            {updatingEngine ? <Loader2 size={15} className="animate-spin" /> : <Cpu size={15} />}
            Update
          </button>
        </Row>
      </Section>

      <Section title="About" icon={<Info size={16} />}>
        <p className="text-xs leading-relaxed text-white/40">
          Universal Video Downloader is powered by the open-source{' '}
          <button
            className="text-accent-300 hover:underline"
            onClick={() => window.api.openExternal('https://github.com/yt-dlp/yt-dlp')}
          >
            yt-dlp
          </button>{' '}
          engine and ffmpeg. Please respect the terms of service and copyright of the sites you
          download from.
        </p>
        <button
          className="btn-ghost"
          onClick={() =>
            window.api.openExternal('https://github.com/DenisHumen/Universal-Video-Downloader-')
          }
        >
          <Github size={15} /> View on GitHub
        </button>
      </Section>

      <p className="pb-4 text-center text-[11px] text-white/25">
        {appInfo?.platform} · {appInfo?.arch} · Made with ♥ for the open web
      </p>
    </div>
  )
}
