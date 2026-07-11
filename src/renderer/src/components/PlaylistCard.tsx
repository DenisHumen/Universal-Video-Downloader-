import { useState } from 'react'
import { Download, ListVideo, Loader2, Music, Sparkles, Video } from 'lucide-react'
import type { DownloadMode, MediaInfo, QualityPreset } from '@shared/types'
import Segmented from './Segmented'
import { initialMode, initialQuality } from '../lib/quality'
import { toast } from '../lib/toast'
import { useStore } from '../store'

interface Props {
  info: MediaInfo
  onDone: () => void
}

export default function PlaylistCard({ info, onDone }: Props): JSX.Element {
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const [mode, setMode] = useState<DownloadMode>(initialMode(settings))
  const [quality, setQuality] = useState<QualityPreset>(initialQuality(settings))
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const entries = info.entries || []

  const queue = async (urls: { url: string; title: string }[]): Promise<void> => {
    for (const e of urls) {
      await window.api.startDownload({
        url: e.url,
        title: e.title,
        mode,
        quality: mode === 'audio' ? 'audio' : quality
      })
    }
  }

  const downloadAll = async (): Promise<void> => {
    setBusy(true)
    try {
      await queue(entries)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start the download', 'error')
      return
    } finally {
      setBusy(false)
    }
    toast(`Added ${entries.length} videos to the queue`, 'success')
    onDone()
    setView('downloads')
  }

  const downloadOne = async (e: { url: string; title: string }): Promise<void> => {
    await queue([e])
    setAdded((prev) => new Set(prev).add(e.url))
    toast('Added to the queue', 'success')
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.06] p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-cream">
          <ListVideo size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-cream">{info.title}</h2>
          <p className="mono text-xs text-white/40">{entries.length} videos · {info.extractor}</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="group-title">format</p>
          <Segmented
            layoutId="pl-mode"
            value={mode}
            onChange={(v) => setMode(v as DownloadMode)}
            options={[
              { value: 'video', label: 'video', icon: <Video size={15} /> },
              { value: 'audio', label: 'audio only', icon: <Music size={15} /> }
            ]}
          />
        </div>
        {mode === 'video' && (
          <div>
            <p className="group-title">quality</p>
            <Segmented
              layoutId="pl-quality"
              value={quality}
              onChange={(v) => setQuality(v as QualityPreset)}
              options={[
                { value: 'best', label: 'best', icon: <Sparkles size={12} /> },
                { value: '2160', label: '4K' },
                { value: '1440', label: '1440p' },
                { value: '1080', label: '1080p' },
                { value: '720', label: '720p' },
                { value: '480', label: '480p' },
                { value: '360', label: '360p' }
              ]}
            />
          </div>
        )}

        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {entries.map((e) => (
            <div
              key={e.url}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
            >
              <span className="truncate text-xs text-cream/90" title={e.title}>
                {e.title}
              </span>
              <button
                className="btn-icon h-7 w-7 shrink-0"
                title="Download this one"
                disabled={added.has(e.url)}
                onClick={() => downloadOne(e)}
              >
                <Download size={14} />
              </button>
            </div>
          ))}
        </div>

        <button className="btn-primary w-full py-3 text-[15px]" onClick={downloadAll} disabled={busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          download all ({entries.length})
        </button>
      </div>
    </div>
  )
}
