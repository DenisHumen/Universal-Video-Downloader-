import { useMemo, useState } from 'react'
import { CheckCheck, Crown, Download, Film, Loader2, Sparkles, Tv, X } from 'lucide-react'
import type { MediaInfo, QualityPreset } from '@shared/types'
import Segmented, { type SegOption } from './Segmented'
import Thumbnail from './Thumbnail'
import { initialQuality, QUALITY_HEIGHTS } from '../lib/quality'
import { toast } from '../lib/toast'
import { useT } from '../i18n'
import { useStore } from '../store'

interface Props {
  info: MediaInfo
  onDone: () => void
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export default function StreamingCard({ info, onDone }: Props): JSX.Element {
  const t = useT()
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const s = info.streaming!

  // Offer only the qualities this provider actually serves, plus automatic
  // "best" — preselected so a too-high default can never break the download.
  const heights = useMemo(() => {
    const known = new Set<number>(QUALITY_HEIGHTS)
    const hs = [...new Set(s.qualities.map((q) => parseInt(q, 10)).filter((h) => known.has(h)))]
    return hs.sort((a, b) => b - a)
  }, [s.qualities])
  const qualityOptions: SegOption[] = [
    { value: 'best', label: t('common.best'), icon: <Sparkles size={12} /> },
    ...heights.map((h) => ({ value: String(h), label: `${h}p` }))
  ]

  const [translatorId, setTranslatorId] = useState(s.defaultTranslator)
  const [season, setSeason] = useState(s.seasons[0]?.season ?? 1)
  const [selected, setSelected] = useState<Record<number, number[]>>({})
  const [quality, setQuality] = useState<QualityPreset>(initialQuality(settings, heights[0] || 0))
  const [busy, setBusy] = useState(false)

  const translatorName = s.translators.find((tr) => tr.id === translatorId)?.name || ''
  const seasonsForT = s.episodesByTranslator?.[translatorId] ?? s.seasons
  const currentSeason = seasonsForT.find((x) => x.season === season) ?? seasonsForT[0]
  const totalSelected = useMemo(
    () => Object.values(selected).reduce((n, arr) => n + arr.length, 0),
    [selected]
  )

  const changeTranslator = (id: string): void => {
    setTranslatorId(id)
    const next = s.episodesByTranslator?.[id] ?? s.seasons
    setSeason(next[0]?.season ?? 1)
    setSelected({})
  }

  const buildEpisodeUrl = (seasonNum: number, ep: number): string =>
    s.provider === 'yummyani'
      ? `uvd-yummy://${translatorId}/${ep}/${quality}`
      : `uvd-rezka://${s.host}/${s.id}/${translatorId}/${seasonNum}/${ep}/${quality}`

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
    if (!totalSelected) {
      toast(t('streaming.selectEpisode'), 'error')
      return
    }
    setBusy(true)
    let count = 0
    try {
      for (const [seasonStr, eps] of Object.entries(selected)) {
        for (const ep of eps) {
          await window.api.startDownload({
            url: buildEpisodeUrl(Number(seasonStr), ep),
            title: `${s.title} - S${pad2(Number(seasonStr))}E${pad2(ep)} (${translatorName})`,
            thumbnail: s.thumbnail,
            mode: 'video',
            quality
          })
          count++
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      return
    } finally {
      setBusy(false)
    }
    toast(t('streaming.addedEpisodes', { count }), 'success')
    onDone()
    setView('downloads')
  }

  const queueMovie = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.startDownload({
        url:
          s.provider === 'yummyani'
            ? `uvd-yummy://${translatorId}/1/${quality}`
            : `uvd-rezka://${s.host}/${s.id}/${translatorId}/movie/0/${quality}`,
        title: `${s.title}${translatorName ? ` (${translatorName})` : ''}`,
        thumbnail: s.thumbnail,
        mode: 'video',
        quality
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : t('home.startFailed'), 'error')
      return
    } finally {
      setBusy(false)
    }
    toast(t('home.addedToQueue'), 'success')
    onDone()
    setView('downloads')
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-fg/[0.06] p-4">
        <Thumbnail
          src={s.thumbnail}
          pageUrl={info.webpageUrl}
          className="h-24 w-16 shrink-0 rounded-xl object-cover"
          loading="eager"
          fallback={
            <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-xl bg-fg/[0.05] text-fg/25">
              {s.isSeries ? <Tv size={20} /> : <Film size={20} />}
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-cream">{s.title}</h2>
          <p className="mono mt-0.5 text-xs text-fg/40">
            {s.isSeries
              ? seasonsForT.length > 1
                ? t('streaming.seriesSeasons', { count: seasonsForT.length })
                : t('streaming.series')
              : t('streaming.movie')}{' '}
            · {s.provider === 'yummyani' ? 'YummyAnime' : 'HDrezka'}
          </p>
          <span className="mono mt-2 inline-block rounded-lg bg-fg/[0.06] px-2 py-0.5 text-[10px] text-fg/50">
            {s.host}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* Translator / voiceover */}
        {s.translators.length > 1 && (
          <div>
            <p className="group-title">{t('streaming.voiceover')}</p>
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {s.translators.map((tr) => {
                const active = tr.id === translatorId
                return (
                  <button
                    key={tr.id}
                    onClick={() => !tr.premium && changeTranslator(tr.id)}
                    disabled={tr.premium}
                    title={tr.premium ? t('streaming.premiumHint') : undefined}
                    className={`no-drag flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      tr.premium
                        ? 'cursor-not-allowed bg-fg/[0.02] text-fg/30'
                        : active
                          ? 'bg-accent text-accent-fg'
                          : 'bg-fg/[0.05] text-fg/60 hover:text-cream'
                    }`}
                  >
                    {tr.name}
                    {tr.premium && (
                      <span className="flex items-center gap-0.5 rounded bg-warn/15 px-1 py-0.5 text-[9px] font-bold uppercase text-warn">
                        <Crown size={9} /> {t('streaming.premium')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {s.isSeries ? (
          <>
            {/* Season */}
            {seasonsForT.length > 1 && (
              <div>
                <p className="group-title">{t('streaming.season')}</p>
                <Segmented
                  layoutId="rz-season"
                  fill={false}
                  value={String(season)}
                  onChange={(v) => setSeason(Number(v))}
                  options={seasonsForT.map((x) => ({ value: String(x.season), label: String(x.season) }))}
                />
              </div>
            )}

            {/* Episodes */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="group-title mb-0">{t('streaming.episodes')}</p>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={selectAll}>
                    <CheckCheck size={13} /> {t('common.all')}
                  </button>
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={clearSeason}>
                    <X size={13} /> {t('common.clear')}
                  </button>
                </div>
              </div>
              <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {currentSeason?.episodes.map((ep) => {
                  const active = (selected[season] || []).includes(ep)
                  return (
                    <button
                      key={ep}
                      onClick={() => toggleEpisode(ep)}
                      className={`no-drag h-9 w-9 rounded-xl text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-accent text-accent-fg'
                          : 'bg-fg/[0.05] text-fg/55 hover:bg-fg/[0.1] hover:text-cream'
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
              <p className="group-title">{t('streaming.quality')}</p>
              <Segmented
                layoutId="rz-quality"
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={qualityOptions}
              />
            </div>

            <button className="btn-primary w-full py-3 text-[15px]" onClick={queueSeries} disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {t('playlist.selected', { count: totalSelected })}
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="group-title">{t('streaming.quality')}</p>
              <Segmented
                layoutId="rz-quality"
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={qualityOptions}
              />
            </div>
            <button className="btn-primary w-full py-3 text-[15px]" onClick={queueMovie} disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {t('common.download')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
