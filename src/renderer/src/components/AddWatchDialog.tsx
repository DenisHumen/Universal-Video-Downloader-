import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Film, Loader2, X } from 'lucide-react'
import { dialog, overlay } from '../lib/motion'
import { useT } from '../i18n'
import { toast } from '../lib/toast'
import { describeError } from '../lib/errors'
import Thumbnail from './Thumbnail'
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
  const [url, setUrl] = useState(initial?.url ?? '')
  const [looking, setLooking] = useState(false)
  const [offer, setOffer] = useState<SeriesOffer | null>(null)
  const [translatorId, setTranslatorId] = useState('')
  const [quality, setQuality] = useState('720p')
  const [saving, setSaving] = useState(false)

  const look = async (keep?: WatchIntent): Promise<void> => {
    const target = (keep?.url ?? url).trim()
    if (!target) return
    setLooking(true)
    try {
      const found = await window.api.autoDescribe(target)
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

  const add = async (): Promise<void> => {
    if (!offer) return
    setSaving(true)
    try {
      const created = await window.api.autoAdd({
        url: offer.url,
        title: offer.title,
        thumbnail: offer.thumbnail,
        provider: offer.provider,
        translatorId,
        translatorName: offer.translators.find((x) => x.id === translatorId)?.name,
        quality,
        enabled: true,
        intervalMinutes: 360,
        nextCheckAt: 0,
        failures: 0,
        /*
          Everything already out is marked as seen. Somebody adding a series
          part-way through a season wants the next episode, not a sudden queue
          of twenty they already have — and the ones they do want are a normal
          download away.
        */
        seen: [],
        steps: [{ id: crypto.randomUUID(), kind: 'download', enabled: true }]
      })
      onAdded(created.id)
    } catch (err) {
      toast(describeError(err), 'error')
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        {...overlay}
        className="fixed inset-0 flex items-center justify-center bg-canvas/80 p-6"
        style={{ zIndex: 'var(--z-modal)' }}
        onClick={onClose}
      >
        <motion.div
          {...dialog}
          role="dialog"
          aria-modal="true"
          className="panel w-full max-w-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
            <h2 className="h2 flex-1">{t('auto.addTitle')}</h2>
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
                <button className="btn" onClick={() => void look()} disabled={looking || !url.trim()}>
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
                      {t('auto.dubCount', { n: String(offer.translators.length) })}
                    </p>
                  </div>
                </div>

                <div>
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
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn-solid" onClick={() => void add()} disabled={!offer || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('auto.startWatching')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
