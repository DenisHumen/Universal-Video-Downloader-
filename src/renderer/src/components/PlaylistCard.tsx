import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { DownloadMode, MediaInfo, PlaylistEntry, QualityPreset } from '@shared/types'
import Choice from './Choice'
import { initialMode, initialQuality } from '../lib/quality'
import { queueDownloads } from '../lib/queue'
import { useT } from '../i18n'
import { useStore } from '../store'

interface Props {
  info: MediaInfo
  onDone: () => void
}

/** Fixed, so a spacer can stand in exactly for the rows that aren't rendered. */
const ROW_HEIGHT = 36
/** `max-h-56` in pixels — the starting guess, before the list is measured. */
const VIEWPORT_HEIGHT = 224
/** Rows built past each edge, so a flick doesn't reveal blank space. */
const OVERSCAN = 6

/** A channel or playlist: pick a format once, then choose what to take. */
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

  /*
    Only the rows on screen are built.

    The channel depth setting goes up to 5000. Rendering five thousand buttons,
    each with an icon and a hover transition, to show the six that fit in a
    224px box is how pasting a large channel link made the window stop
    responding. Everything else — the numbering, "select all", the range picker
    — works off `entries` and is untouched; this is only about what reaches the
    DOM.
  */
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(VIEWPORT_HEIGHT)

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const measure = (): void => setViewport(node.clientHeight || VIEWPORT_HEIGHT)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const visible = useMemo(() => {
    const count = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    return {
      first,
      rows: entries.slice(first, first + count).map((entry, i) => ({ entry, index: first + i }))
    }
  }, [entries, scrollTop, viewport])

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

  const run = async (list: PlaylistEntry[]): Promise<void> => {
    if (!list.length) return
    setBusy(true)
    let ok = false
    try {
      ok = await queueDownloads(
        list.map((e) => ({
          url: e.url,
          title: e.title,
          thumbnail: e.thumbnail,
          mode,
          quality: mode === 'audio' ? 'audio' : quality
        }))
      )
    } finally {
      setBusy(false)
    }
    if (!ok) return
    onDone()
    setView('downloads')
  }

  const chosen = entries.filter((e) => selected.has(e.url))

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-edge p-4">
        <h2 className="h2 truncate">{info.title}</h2>
        <p className="mono mt-1 text-[12px] text-ink-2">
          {t('playlist.videos', { count: entries.length })} · {info.extractor}
        </p>
      </div>

      <div className="space-y-5 p-4">
        <div>
          <p className="label mb-2">{t('common.format')}</p>
          <Choice
            label={t('common.format')}
            value={mode}
            onChange={(v) => setMode(v as DownloadMode)}
            options={[
              { value: 'video', label: t('common.video') },
              { value: 'audio', label: t('common.audioOnly') }
            ]}
          />
        </div>

        {mode === 'video' && (
          <div>
            <p className="label mb-2">{t('common.quality')}</p>
            <Choice
              label={t('common.quality')}
              value={quality}
              onChange={(v) => setQuality(v as QualityPreset)}
              options={[
                { value: 'best', label: t('common.best') },
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="label">{t('playlist.videos', { count: entries.length })}</p>
            <div className="flex items-center gap-3">
              <button
                className="btn-quiet px-3 py-1.5"
                onClick={() => setSelected(new Set(entries.map((e) => e.url)))}
              >
                {t('playlist.selectAll')}
              </button>
              <button
                className="btn-quiet px-3 py-1.5"
                onClick={() => setSelected(new Set())}
              >
                {t('common.clear')}
              </button>
            </div>
          </div>

          {/* Whole channels can run to hundreds of videos, so let the user take
              a slice rather than ticking boxes one at a time. */}
          {entries.length > 8 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="mono shrink-0 text-[12px] text-ink-2">{t('playlist.range')}</span>
              <input
                type="number"
                min={1}
                max={entries.length}
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="field mono w-[72px] px-2 text-center text-[13px]"
              />
              <span className="text-ink-3">–</span>
              <input
                type="number"
                min={1}
                max={entries.length}
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="field mono w-[72px] px-2 text-center text-[13px]"
              />
              <button className="btn-quiet px-3 py-1.5" onClick={selectRange}>
                {t('playlist.selectRange')}
              </button>
            </div>
          )}

          {/* A checklist, so the whole list reads as one column of decisions
              rather than a stack of separately bordered buttons. */}
          <div
            ref={scrollerRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="max-h-56 overflow-y-auto border-t border-edge"
          >
            {/*
              The spacer holds the full height, so the scrollbar is the size it
              would have been and every position in it lands on the right entry.
              It is a separate element rather than padding on the scroller,
              because padding counts towards the scroller's own `clientHeight` —
              measuring the viewport through it reads back the height of the
              content it is standing in for.
            */}
            <div className="relative" style={{ height: entries.length * ROW_HEIGHT }}>
              <ul className="absolute inset-x-0" style={{ top: visible.first * ROW_HEIGHT }}>
                {visible.rows.map(({ entry: e, index: i }) => {
                  const on = selected.has(e.url)
                  return (
                    <li key={e.url} style={{ height: ROW_HEIGHT }}>
                      <button
                        onClick={() => toggle(e.url)}
                        aria-pressed={on}
                        className="flex h-full w-full items-center gap-3 border-b border-edge px-1 text-left transition-colors duration-fast ease-ease hover:bg-sink"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-fast ease-ease ${
                            on ? 'border-accent bg-accent text-accent-fg' : 'border-edge-strong'
                          }`}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="mono w-8 shrink-0 text-[11px] tabular-nums text-ink-3">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="truncate text-[13px] text-ink" title={e.title}>
                          {e.title}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {chosen.length > 0 && (
            <button className="btn-solid flex-1 py-3" onClick={() => run(chosen)} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {t('playlist.selected', { count: chosen.length })}
            </button>
          )}
          <button
            className={`${chosen.length ? 'btn-quiet' : 'btn-solid'} flex-1 py-3`}
            onClick={() => run(entries)}
            disabled={busy}
          >
            {busy && !chosen.length ? <Loader2 size={15} className="animate-spin" /> : null}
            {t('playlist.downloadAll', { count: entries.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
