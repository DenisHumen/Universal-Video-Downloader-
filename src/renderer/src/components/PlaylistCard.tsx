import { useState } from 'react'
import { Check, CheckCheck, Download, ListVideo, Loader2, Music, Sparkles, Video, X } from 'lucide-react'
import type { DownloadMode, MediaInfo, PlaylistEntry, QualityPreset } from '@shared/types'
import Segmented from './Segmented'
import { initialMode, initialQuality } from '../lib/quality'
import { toast } from '../lib/toast'
import { useT } from '../i18n'
import { useStore } from '../store'

interface Props {
  info: MediaInfo
  onDone: () => void
}

export default function PlaylistCard({ info, onDone }: Props): JSX.Element {
  const t = useT()
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const [mode, setMode] = useState<DownloadMode>(initialMode(settings))
  const [quality, setQuality] = useState<QualityPreset>(initialQuality(settings))
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rangeFrom, setRangeFrom] = useState('1')
  const [rangeTo, setRangeTo] = useState('')

  const entries = info.entries || []

  const selectRange = (): void => {
    const from = Math.max(1, Number(rangeFrom) || 1)
    const to = Math.min(entries.length, Number(rangeTo) || entries.length)
    if (to < from) return
    setSelected(new Set(entries.slice(from - 1, to).map((e) => e.url)))
  }

  const toggle = (url: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }
  const selectAll = (): void => setSelected(new Set(entries.map((e) => e.url)))
  const clearAll = (): void => setSelected(new Set())

  const queue = async (list: PlaylistEntry[]): Promise<number> => {
    for (const e of list) {
      await window.api.startDownload({
        url: e.url,
        title: e.title,
        thumbnail: e.thumbnail,
        mode,
        quality: mode === 'audio' ? 'audio' : quality
      })
    }
    return list.length
  }

  const run = async (list: PlaylistEntry[]): Promise<void> => {
    if (!list.length) return
    setBusy(true)
    let count = 0
    try {
      count = await queue(list)
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      return
    } finally {
      setBusy(false)
    }
    toast(t('playlist.added', { count }), 'success')
    onDone()
    setView('downloads')
  }

  const chosen = entries.filter((e) => selected.has(e.url))

  return (
    <div className="card card-lit overflow-hidden">
      <div className="flex items-center gap-3 border-b border-fg/[0.06] p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fg/[0.06] text-cream">
          <ListVideo size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-cream">{info.title}</h2>
          <p className="mono text-xs text-fg/55">
            {t('playlist.videos', { count: entries.length })} · {info.extractor}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="group-title">{t('common.format')}</p>
          <Segmented
            layoutId="pl-mode"
            value={mode}
            onChange={(v) => setMode(v as DownloadMode)}
            options={[
              { value: 'video', label: t('common.video'), icon: <Video size={15} /> },
              { value: 'audio', label: t('common.audioOnly'), icon: <Music size={15} /> }
            ]}
          />
        </div>
        {mode === 'video' && (
          <div>
            <p className="group-title">{t('common.quality')}</p>
            <Segmented
              layoutId="pl-quality"
              value={quality}
              onChange={(v) => setQuality(v as QualityPreset)}
              options={[
                { value: 'best', label: t('common.best'), icon: <Sparkles size={12} /> },
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

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="group-title mb-0">{t('playlist.videos', { count: entries.length })}</p>
            <div className="flex items-center gap-2">
              <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={selectAll}>
                <CheckCheck size={13} /> {t('playlist.selectAll')}
              </button>
              <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={clearAll}>
                <X size={13} /> {t('common.clear')}
              </button>
            </div>
          </div>

          {/* Whole channels can run to hundreds of videos, so let the user take
              a slice rather than ticking boxes one at a time. */}
          {entries.length > 8 && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-fg/[0.06] bg-fg/[0.02] px-3 py-2">
              <span className="mono shrink-0 text-[11px] text-fg/55">{t('playlist.range')}</span>
              <input
                type="number"
                min={1}
                max={entries.length}
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="no-drag w-16 rounded-lg border border-fg/[0.08] bg-ink-900 px-2 py-1 text-center text-xs text-cream outline-none focus:border-accent/40"
              />
              <span className="text-fg/50">–</span>
              <input
                type="number"
                min={1}
                max={entries.length}
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="no-drag w-16 rounded-lg border border-fg/[0.08] bg-ink-900 px-2 py-1 text-center text-xs text-cream outline-none focus:border-accent/40"
              />
              <button className="btn-ghost ml-auto px-2.5 py-1.5 text-xs" onClick={selectRange}>
                {t('playlist.selectRange')}
              </button>
            </div>
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {entries.map((e) => {
              const isSelected = selected.has(e.url)
              return (
                <button
                  key={e.url}
                  onClick={() => toggle(e.url)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-accent/50 bg-accent/[0.08]'
                      : 'border-fg/[0.05] bg-fg/[0.02] hover:bg-fg/[0.05]'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                      isSelected ? 'border-accent bg-accent text-accent-fg' : 'border-fg/20'
                    }`}
                  >
                    {isSelected && <Check size={11} />}
                  </span>
                  <span className="truncate text-xs text-cream/90" title={e.title}>
                    {e.title}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2">
          {chosen.length > 0 && (
            <button
              className="btn-primary flex-1 py-3 text-[15px]"
              onClick={() => run(chosen)}
              disabled={busy}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {t('playlist.selected', { count: chosen.length })}
            </button>
          )}
          <button
            className={`${chosen.length ? 'btn-ghost' : 'btn-primary'} flex-1 py-3 text-[15px]`}
            onClick={() => run(entries)}
            disabled={busy}
          >
            {busy && !chosen.length ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Download size={18} />
            )}
            {t('playlist.downloadAll', { count: entries.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
