import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MediaInfo, QualityPreset } from '@shared/types'
import Choice, { type ChoiceOption } from './Choice'
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

/** Translator → season → episodes → quality, in the order the site imposes. */
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
  const qualityOptions: ChoiceOption[] = [
    { value: 'best', label: t('common.best') },
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

  const episodesOfSeason = currentSeason?.episodes ?? []
  const chosenHere = selected[season] || []

  return (
    <div className="block overflow-hidden">
      <div className="flex gap-4 border-b border-edge p-4">
        <Thumbnail
          src={s.thumbnail}
          pageUrl={info.webpageUrl}
          className="h-24 w-16 shrink-0 rounded-2 object-cover"
          loading="eager"
          fallback={<div className="h-24 w-16 shrink-0 rounded-2 bg-sink" />}
        />
        <div className="min-w-0 flex-1">
          <h2 className="h2">{s.title}</h2>
          <p className="mono mt-1 text-[12px] text-ink-2">
            {s.isSeries
              ? seasonsForT.length > 1
                ? t('streaming.seriesSeasons', { count: seasonsForT.length })
                : t('streaming.series')
              : t('streaming.movie')}
            {'  ·  '}
            {s.provider === 'yummyani' ? 'YummyAnime' : 'HDrezka'}
          </p>
          <span className="tag mt-2.5 inline-flex">{s.host}</span>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {s.translators.length > 1 && (
          <div>
            <p className="label mb-2">{t('streaming.voiceover')}</p>
            <div className="max-h-32 overflow-y-auto">
              <Choice
                label={t('streaming.voiceover')}
                value={translatorId}
                onChange={changeTranslator}
                options={s.translators.map((tr) => ({
                  value: tr.id,
                  label: tr.premium ? `${tr.name} · ${t('streaming.premium')}` : tr.name,
                  disabled: tr.premium,
                  title: tr.premium ? t('streaming.premiumHint') : undefined
                }))}
              />
            </div>
          </div>
        )}

        {s.isSeries ? (
          <>
            {seasonsForT.length > 1 && (
              <div>
                <p className="label mb-2">{t('streaming.season')}</p>
                <Choice
                  label={t('streaming.season')}
                  value={String(season)}
                  onChange={(v) => setSeason(Number(v))}
                  options={seasonsForT.map((x) => ({ value: String(x.season), label: String(x.season) }))}
                />
              </div>
            )}

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="label">{t('streaming.episodes')}</p>
                <div className="flex items-center gap-3">
                  <button
                    className="btn-quiet px-3 py-1.5"
                    onClick={() =>
                      setSelected((prev) => ({ ...prev, [season]: [...episodesOfSeason] }))
                    }
                  >
                    {t('common.all')}
                  </button>
                  <button
                    className="btn-quiet px-3 py-1.5"
                    onClick={() => setSelected((prev) => ({ ...prev, [season]: [] }))}
                  >
                    {t('common.clear')}
                  </button>
                </div>
              </div>
              {/* Episodes are multi-select, so they're square toggles on a grid
                  rather than pills — a grid of numbers reads as a calendar of
                  what you already have. */}
              <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
                {episodesOfSeason.map((ep) => {
                  const on = chosenHere.includes(ep)
                  return (
                    <button
                      key={ep}
                      onClick={() => toggleEpisode(ep)}
                      aria-pressed={on}
                      className={`no-drag mono h-9 w-9 shrink-0 rounded-1 border text-[12px] tabular-nums transition-colors duration-fast ease-ease ${
                        on
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-edge text-ink-2 hover:border-ink-3 hover:text-ink'
                      }`}
                    >
                      {ep}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="label mb-2">{t('streaming.quality')}</p>
              <Choice
                label={t('streaming.quality')}
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={qualityOptions}
              />
            </div>

            <button className="btn-solid w-full py-3.5 text-[14px]" onClick={queueSeries} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('playlist.selected', { count: totalSelected })}
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="label mb-2">{t('streaming.quality')}</p>
              <Choice
                label={t('streaming.quality')}
                value={quality}
                onChange={(v) => setQuality(v as QualityPreset)}
                options={qualityOptions}
              />
            </div>
            <button className="btn-solid w-full py-3.5 text-[14px]" onClick={queueMovie} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('common.download')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
