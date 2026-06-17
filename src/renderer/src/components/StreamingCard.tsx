import { useMemo, useState } from 'react'
import { CheckCheck, Download, Film, Loader2, Tv, X } from 'lucide-react'
import type { MediaInfo, QualityPreset } from '@shared/types'
import Segmented from './Segmented'
import { toast } from '../lib/toast'
import { useStore } from '../store'

interface Props {
  info: MediaInfo
  onDone: () => void
}

const QUALITIES: { q: QualityPreset; label: string }[] = [
  { q: 'best', label: 'best' },
  { q: '1080', label: '1080p' },
  { q: '720', label: '720p' },
  { q: '480', label: '480p' },
  { q: '360', label: '360p' }
]

const pad2 = (n: number): string => String(n).padStart(2, '0')

export default function StreamingCard({ info, onDone }: Props): JSX.Element {
  const setView = useStore((s) => s.setView)
  const s = info.streaming!
  const [translatorId, setTranslatorId] = useState(s.defaultTranslator)
  const [season, setSeason] = useState(s.seasons[0]?.season ?? 1)
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const [quality, setQuality] = useState<QualityPreset>('1080')
  const [busy, setBusy] = useState(false)

  const translatorName = s.translators.find((t) => t.id === translatorId)?.name || ''
  const currentSeason = s.seasons.find((x) => x.season === season)
  const totalSelected = useMemo(
    () => Object.values(selected).reduce((n, arr) => n + arr.length, 0),
    [selected]
  )

  const toggleEpisode = (ep: number): void => {
    setSelected((prev) => {
      const arr = prev[season] || []
      const next = arr.includes(ep) ? arr.filter((e) => e !== ep) : [...arr, ep].sort((a, b) => a - b)
      return { ...prev, [season]: next }
    })
  }
  const selectAll = (): void => {
    if (!currentSeason) return
    setSelected((prev) => ({ ...prev, [season]: [...currentSeason.episodes] }))
  }
  const clearSeason = (): void => setSelected((prev) => ({ ...prev, [season]: [] }))

  const queueSeries = async (): Promise<void> => {
    setBusy(true)
    let count = 0
    for (const [seasonStr, eps] of Object.entries(selected)) {
      for (const ep of eps) {
        const q = quality === 'best' ? 'best' : quality
        await window.api.startDownload({
          url: `uvd-rezka://${s.host}/${s.id}/${translatorId}/${seasonStr}/${ep}/${q}`,
          title: `${s.title} - S${pad2(Number(seasonStr))}E${pad2(ep)} (${translatorName})`,
          thumbnail: s.thumbnail,
          mode: 'video',
          quality
        })
        count++
      }
    }
    setBusy(false)
    if (count) {
      toast(`Added ${count} episode${count > 1 ? 's' : ''} to the queue`, 'success')
      onDone()
      setView('downloads')
    } else {
      toast('Select at least one episode', 'error')
    }
  }

  const queueMovie = async (): Promise<void> => {
    setBusy(true)
    await window.api.startDownload({
      url: `uvd-rezka://${s.host}/${s.id}/${translatorId}/movie/0/${quality}`,
      title: `${s.title}${translatorName ? ` (${translatorName})` : ''}`,
      thumbnail: s.thumbnail,
      mode: 'video',
      quality
    })
    setBusy(false)
    toast('Added to the queue', 'success')
    onDone()
    setView('downloads')
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-white/[0.06] p-4">
        {s.thumbnail ? (
          <img
            src={s.thumbnail}
            alt=""
            className="h-24 w-16 shrink-0 rounded-xl object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-white/25">
            {s.isSeries ? <Tv size={20} /> : <Film size={20} />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-cream">{s.title}</h2>
          <p className="mono mt-0.5 text-xs text-white/40">
            {s.isSeries ? `series · ${s.seasons.length} seasons` : 'movie'} · HDrezka
          </p>
          <span className="mono mt-2 inline-block rounded-lg bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">
            {s.host}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* Translator / voiceover */}
        {s.translators.length > 1 && (
          <div>
            <p className="group-title">voiceover · озвучка</p>
            <div className="flex flex-wrap gap-1.5">
              {s.translators.map((t) => {
                const active = t.id === translatorId
                return (
                  <button
                    key={t.id}
                    onClick={() => setTranslatorId(t.id)}
                    className={`no-drag rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      active ? 'bg-cream text-ink-950' : 'bg-white/[0.05] text-white/60 hover:text-cream'
                    }`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {s.isSeries ? (
          <>
            {/* Season */}
            <div>
              <p className="group-title">season · сезон</p>
              <Segmented
                layoutId="rz-season"
                fill={false}
                value={String(season)}
                onChange={(v) => setSeason(Number(v))}
                options={s.seasons.map((x) => ({ value: String(x.season), label: String(x.season) }))}
              />
            </div>

            {/* Episodes */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="group-title mb-0">episodes · серии</p>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={selectAll}>
                    <CheckCheck size={13} /> all
                  </button>
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={clearSeason}>
                    <X size={13} /> clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentSeason?.episodes.map((ep) => {
                  const active = (selected[season] || []).includes(ep)
                  return (
                    <button
                      key={ep}
                      onClick={() => toggleEpisode(ep)}
                      className={`no-drag h-9 w-9 rounded-xl text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-cream text-ink-950'
                          : 'bg-white/[0.05] text-white/55 hover:bg-white/[0.1] hover:text-cream'
                      }`}
                    >
                      {ep}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Quality */}
            <div>
              <p className="group-title">quality · качество</p>
              <Segmented
                layoutId="rz-quality"
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={QUALITIES.map((q) => ({ value: q.q, label: q.label }))}
              />
            </div>

            <button className="btn-primary w-full py-3 text-[15px]" onClick={queueSeries} disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              download selected ({totalSelected})
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="group-title">quality · качество</p>
              <Segmented
                layoutId="rz-quality"
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={QUALITIES.map((q) => ({ value: q.q, label: q.label }))}
              />
            </div>
            <button className="btn-primary w-full py-3 text-[15px]" onClick={queueMovie} disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              download
            </button>
          </>
        )}
      </div>
    </div>
  )
}
