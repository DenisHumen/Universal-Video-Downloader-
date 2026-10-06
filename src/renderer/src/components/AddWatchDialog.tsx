import { useEffect, useId, useState } from 'react'
import { CalendarClock, Film, Loader2, Radar, X } from 'lucide-react'
import { resolveLanguage, useT } from '../i18n'
import { toast } from '../lib/toast'
import { describeError } from '../lib/errors'
import { releaseDate, releaseText } from '../lib/release'
import { useStore } from '../store'
import Thumbnail from './Thumbnail'
import Modal from './Modal'
import {
  exactDuplicate,
  inheritedSeen,
  MAX_PER_CHECK,
  newEpisodes,
  watchingAlready,
  type Watch
} from '@shared/automation'
import type { SeriesOffer } from '../../../main/automation-ipc'
import type { WatchIntent } from '../store'

/**
 * Adding a series to watch.
 *
 * Two steps on purpose. Pasting a link and being asked nothing would mean
 * guessing which dub to follow, and the dubs are not interchangeable: on a
 * typical series they carry different numbers of episodes, so the choice
 * decides what "a new episode" even means. The count is shown beside each one
 * for exactly that reason.
 */
export default function AddWatchDialog({
  initial,
  onClose,
  onAdded
}: {
  /** A series the home screen already resolved: looked up at once, dub and quality kept. */
  initial?: WatchIntent
  onClose: () => void
  onAdded: (id: string) => void
}): JSX.Element {
  const t = useT()
  const titleId = useId()
  const locale = useStore((s) =>
    resolveLanguage(s.settings?.language ?? 'auto', s.appInfo?.locale ?? 'en')
  )
  const [url, setUrl] = useState(initial?.url ?? '')
  const [looking, setLooking] = useState(false)
  const [offer, setOffer] = useState<SeriesOffer | null>(null)
  const [translatorId, setTranslatorId] = useState('')
  const [quality, setQuality] = useState('720p')
  const [saving, setSaving] = useState(false)
  /** Whether the episodes already out are fetched too. On by default: it is what every watch did before it was asked. */
  const [backfill, setBackfill] = useState(true)
  /** What is watched already, read alongside the series so a duplicate can be pointed out before it is made. */
  const [watches, setWatches] = useState<Watch[]>([])

  const look = async (keep?: WatchIntent): Promise<void> => {
    const target = (keep?.url ?? url).trim()
    if (!target) return
    setLooking(true)
    try {
      const [found, list] = await Promise.all([
        window.api.autoDescribe(target),
        window.api.autoList().catch((): Watch[] => [])
      ])
      setWatches(list)
      setOffer(found)
      /*
        What was chosen on the home screen is honoured when it exists here,
        and quietly replaced when it does not - a dub this listing lacks, or
        "best", which is a preference rather than a height.
      */
      const dub = found.translators.some((x) => x.id === keep?.translatorId)
        ? (keep?.translatorId as string)
        : found.defaultTranslator
      const wanted = keep?.quality && keep.quality !== 'best' ? parseInt(keep.quality, 10) : NaN
      const height = found.qualities.find((q) => parseInt(q, 10) === wanted)
      setTranslatorId(dub)
      setQuality(height ?? found.qualities[found.qualities.length - 1] ?? 'best')
    } catch (err) {
      toast(describeError(err), 'error')
    } finally {
      setLooking(false)
    }
  }

  useEffect(() => {
    if (initial?.url) void look(initial)
    // Once, for the series that was handed over; typing is handled by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dub = offer?.translators.find((x) => x.id === translatorId)
  const series = offer && {
    provider: offer.provider,
    url: offer.url,
    translatorId: offer.upcoming ? '' : translatorId
  }
  const already = series && watchingAlready(watches, series)
  /** Same series, dub and quality: main would refuse it, so the button does too. */
  const copy =
    series && exactDuplicate(watches, { ...series, quality, pending: Boolean(offer?.upcoming) })
  /*
    What "also download" would fetch: the dub's episodes, less any that a
    watch already following it has handled - those are not news to a second
    watch either, and main leaves them out whatever the box says.
  */
  const backlog =
    series && dub ? newEpisodes(inheritedSeen(watches, { ...series, seen: [] }), dub.list) : []

  const add = async (): Promise<void> => {
    if (!offer) return
    setSaving(true)
    try {
      const created = await window.api.autoAdd({
        url: offer.url,
        title: offer.title,
        thumbnail: offer.thumbnail,
        provider: offer.provider,
        /*
          Nothing is out, so there is no dub to choose. The watch is stored
          without one and adopts the fullest dub the moment episodes appear.
        */
        translatorId: offer.upcoming ? '' : translatorId,
        translatorName: offer.translators.find((x) => x.id === translatorId)?.name,
        pending: Boolean(offer.upcoming) || undefined,
        releaseAt: offer.upcoming?.releaseAt,
        quality,
        enabled: true,
        intervalMinutes: 360,
        nextCheckAt: 0,
        failures: 0,
        /*
          The back catalogue is the checkbox's to decide. Ticked - the default,
          and what every watch did before there was a choice - nothing counts
          as seen, and the first check fetches what is out, a check's worth at
          a time. Unticked, everything out now is marked seen and only what
          comes next is fetched: somebody adding a series part-way through a
          season may well have the rest. Nothing is out for an upcoming title,
          so there is nothing to mark.
        */
        seen: offer.upcoming || backfill ? [] : dub?.list ?? [],
        steps: [{ id: crypto.randomUUID(), kind: 'download', enabled: true }]
      })
      // Only when the list read with the series was out of date; the button is off for a known copy.
      if (created.existing) toast(t('auto.alreadyWatching'), 'info')
      onAdded(created.id)
    } catch (err) {
      toast(describeError(err), 'error')
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="panel w-full max-w-lg overflow-hidden">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <h2 className="h2 flex-1" id={titleId}>
          {t('auto.addTitle')}
        </h2>
        <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="label mb-2">{t('auto.seriesUrl')}</p>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void look()}
              placeholder="https://…"
              aria-label={t('auto.seriesUrl')}
              className="field mono flex-1 text-[13px]"
              spellCheck={false}
              autoFocus
            />
            <button
              className="btn-quiet"
              onClick={() => void look()}
              disabled={looking || !url.trim()}
            >
              {looking ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('auto.look')}
            </button>
          </div>
          <p className="hint mt-1.5">{t('auto.seriesUrlHint')}</p>
        </div>

        {offer && (
          <>
            <div className="flex gap-3 border-t border-edge pt-4">
              <Thumbnail
                src={offer.thumbnail}
                alt=""
                className="h-24 w-16 shrink-0 rounded"
                fallback={<Film size={18} className="text-ink-3" />}
              />
              <div className="min-w-0">
                <p className="text-[14px] text-ink">{offer.title}</p>
                <p className="hint mt-1">
                  {offer.upcoming
                    ? releaseText(offer.upcoming.releaseAt, t)
                    : t('auto.dubCount', { n: String(offer.translators.length) })}
                </p>
              </div>
            </div>

            {/*
              Pointed out, not forbidden: a second watch at another quality
              or for another share is a fair thing to want. Only an exact
              copy, which could do nothing but fetch every episode twice,
              cannot be added.
            */}
            {already && (
              <div className="well flex gap-3 p-3">
                <Radar size={16} className="mt-0.5 shrink-0 text-ink-2" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">{t('auto.alreadyWatching')}</p>
                  <p className="hint mt-1">
                    {copy ? t('auto.alreadySameQuality') : t('auto.alreadyHint')}
                  </p>
                </div>
                <button
                  className="btn-quiet shrink-0 self-start"
                  onClick={() => onAdded((copy || already).id)}
                >
                  {t('auto.openExisting')}
                </button>
              </div>
            )}

            {offer.upcoming && (
              <div className="well flex gap-3 p-3">
                <CalendarClock size={16} className="mt-0.5 shrink-0 text-ink-2" />
                <div className="min-w-0">
                  {offer.upcoming.releaseAt && (
                    <p className="text-[13px] text-ink">
                      {t('auto.releaseOn', {
                        date: releaseDate(offer.upcoming.releaseAt, locale)
                      })}
                    </p>
                  )}
                  <p className="hint mt-1">{t('auto.upcomingNote')}</p>
                </div>
              </div>
            )}

            <div hidden={Boolean(offer.upcoming)}>
              <p className="label mb-2">{t('auto.dub')}</p>
              <select
                className="field w-full text-[13px]"
                aria-label={t('auto.dub')}
                value={translatorId}
                onChange={(e) => setTranslatorId(e.target.value)}
              >
                {offer.translators.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} — {t('auto.nEpisodes', { n: String(x.episodes) })}
                    {x.premium ? ' ★' : ''}
                  </option>
                ))}
              </select>
              <p className="hint mt-1.5">{t('auto.dubHint')}</p>
            </div>

            {!offer.upcoming && backlog.length > 0 && (
              <div>
                <label className="flex items-center gap-2.5 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={backfill}
                    onChange={(e) => setBackfill(e.target.checked)}
                  />
                  {t('auto.backfill', { n: String(backlog.length) })}
                </label>
                <p className="hint mt-1.5">
                  {backfill && backlog.length > MAX_PER_CHECK
                    ? t('auto.backfillBatches', { n: String(MAX_PER_CHECK) })
                    : t('auto.backfillHint')}
                </p>
              </div>
            )}

            <div>
              <p className="label mb-2">{t('common.quality')}</p>
              <select
                className="field w-full text-[13px]"
                aria-label={t('common.quality')}
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                {offer.qualities.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
        <button className="btn-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          className="btn-solid"
          onClick={() => void add()}
          disabled={!offer || saving || Boolean(copy)}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {already ? t('auto.addAnyway') : t('auto.startWatching')}
        </button>
      </div>
    </Modal>
  )
}
