import { useEffect, useState } from 'react'
import { CalendarClock, Film, Loader2, Radar } from '../ui/icons'
import { ActionRow, ComboRow, Dialog, EntryRow, PreferencesGroup, SwitchRow } from '../ui'
import { resolveLanguage, useT, useTp } from '../i18n'
import { toast } from '../lib/toast'
import { describeError } from '../lib/errors'
import { releaseDate, releaseText } from '../lib/release'
import { useStore } from '../store'
import Thumbnail from './Thumbnail'
import { CHANNEL_PICKS, firstFollow } from '@shared/channel'
import {
  episodeKey,
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
  const tp = useTp()
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
  /** How many of the newest uploads of a channel to fetch on following it. None unless somebody asks. */
  const [latest, setLatest] = useState(0)
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

  /*
    A channel or playlist has no dubs and, usually, far more on it than anybody
    wants at once, so the question is the other way round from a series': nothing
    is fetched unless somebody says so. What another watch of this list has
    handled is not on offer, for the same reason as above.
  */
  const list = offer?.channel
  const handled = new Set(series && list ? inheritedSeen(watches, { ...series, seen: [] }).map(episodeKey) : [])
  const unhandled = list ? list.entries.filter((ref) => !handled.has(episodeKey(ref))) : []
  const pickOptions = CHANNEL_PICKS.filter((n) => n <= unhandled.length).map((n) => ({
    value: String(n),
    label: n === 0 ? t('auto.pickNone') : n === 1 ? t('auto.pickOne') : t('auto.pickLatest', { n })
  }))
  const qualityName = (q: string): string => (q === 'best' ? t('common.best') : q)

  const add = async (): Promise<void> => {
    if (!offer) return
    setSaving(true)
    try {
      const first = list ? firstFollow(unhandled, list.waiting, latest, list.newestLast) : undefined
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
        seen: first ? first.seen : offer.upcoming || backfill ? [] : dub?.list ?? [],
        ...(list && first
          ? {
              owed: first.owed.length ? first.owed : undefined,
              newestLast: list.newestLast || undefined,
              listCount: list.count
            }
          : {}),
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
    <Dialog
      size="md"
      title={t('auto.addTitle')}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-solid" onClick={() => void add()} disabled={!offer || saving || Boolean(copy)}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {already ? t('auto.addAnyway') : t('auto.startWatching')}
          </button>
        </>
      }
    >
      <div className="space-y-6 text-left">
        <PreferencesGroup footer={t('auto.seriesUrlHint')}>
          <EntryRow
            title={t('auto.seriesUrl')}
            mono
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void look()}
            placeholder="https://…"
            spellCheck={false}
            autoFocus
            suffix={
              <button type="button" className="btn-quiet" onClick={() => void look()} disabled={looking || !url.trim()}>
                {looking ? <Loader2 size={14} className="animate-spin" /> : null}
                {t('auto.look')}
              </button>
            }
          />
        </PreferencesGroup>

        {offer && (
          <>
            <PreferencesGroup>
              <ActionRow
                title={offer.title}
                subtitle={
                  offer.upcoming
                    ? releaseText(offer.upcoming.releaseAt, t)
                    : list
                      ? tp('auto.nVideos', list.count ?? list.entries.length)
                      : tp('auto.dubCount', offer.translators.length)
                }
                prefix={<Poster src={offer.thumbnail} />}
              />
              {/*
                Pointed out, not forbidden: a second watch at another quality
                or for another share is a fair thing to want. Only an exact copy,
                which could do nothing but fetch every episode twice, cannot be added.
              */}
              {already && (
                <ActionRow
                  title={t('auto.alreadyWatching')}
                  subtitle={copy ? t('auto.alreadySameQuality') : t('auto.alreadyHint')}
                  prefix={<Radar size={16} />}
                  suffix={
                    <button type="button" className="btn-quiet" onClick={() => onAdded((copy || already).id)}>
                      {t('auto.openExisting')}
                    </button>
                  }
                />
              )}
              {offer.upcoming && (
                <ActionRow
                  title={offer.upcoming.releaseAt ? t('auto.releaseOn', { date: releaseDate(offer.upcoming.releaseAt, locale) }) : t('auto.upcomingNote')}
                  subtitle={offer.upcoming.releaseAt ? t('auto.upcomingNote') : undefined}
                  prefix={<CalendarClock size={16} />}
                />
              )}
            </PreferencesGroup>

            <PreferencesGroup footer={offer.upcoming || list ? undefined : t('auto.dubHint')}>
              {!offer.upcoming && !list && (
                <ComboRow
                  title={t('auto.dub')}
                  value={translatorId}
                  onChange={setTranslatorId}
                  options={offer.translators.map((x) => ({
                    value: x.id,
                    label: `${x.name} — ${tp('auto.nEpisodes', x.episodes)}${x.premium ? ' ★' : ''}`
                  }))}
                />
              )}
              <ComboRow
                title={t('common.quality')}
                value={quality}
                onChange={setQuality}
                options={offer.qualities.map((q) => ({ value: q, label: qualityName(q) }))}
              />
              {list && pickOptions.length > 1 && (
                <ComboRow
                  title={t('auto.pickTitle')}
                  subtitle={t('auto.pickHint')}
                  value={String(latest)}
                  onChange={(v) => setLatest(Number(v))}
                  options={pickOptions}
                />
              )}
              {list && list.waiting.length > 0 && (
                <ActionRow title={t('auto.listLive', { n: list.waiting.length })} prefix={<CalendarClock size={16} />} />
              )}
              {!offer.upcoming && !list && backlog.length > 0 && (
                <SwitchRow
                  title={t('auto.backfill', { n: String(backlog.length) })}
                  subtitle={
                    backfill && backlog.length > MAX_PER_CHECK
                      ? t('auto.backfillBatches', { n: String(MAX_PER_CHECK) })
                      : t('auto.backfillHint')
                  }
                  checked={backfill}
                  onChange={setBackfill}
                />
              )}
            </PreferencesGroup>
          </>
        )}
      </div>
    </Dialog>
  )
}

/** A series poster, or a placeholder tile when the site gave none (kodik). */
export function Poster({ src, size = 'sm' }: { src?: string; size?: 'sm' | 'lg' }): JSX.Element {
  const box = size === 'lg' ? 'h-16 w-12' : 'h-12 w-9'
  return (
    <Thumbnail
      src={src}
      alt=""
      className={`${box} shrink-0 rounded-1 object-cover`}
      fallback={
        <span className={`${box} flex shrink-0 items-center justify-center rounded-1 bg-fill/10 text-ink-2`} aria-hidden="true">
          <Film size={16} />
        </span>
      }
    />
  )
}
