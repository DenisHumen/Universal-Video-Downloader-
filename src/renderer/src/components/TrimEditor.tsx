import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import type { TrimRange } from '@shared/types'
import { clampTime, parseClock, toClock } from '../lib/time'
import { useT } from '../i18n'

interface Props {
  /** Total length of the source, when known. Without it the slider is hidden. */
  duration?: number
  value: TrimRange
  onChange: (range: TrimRange) => void
  /** Extra line under the controls, e.g. "only this part is downloaded". */
  hint?: string
}

type Handle = 'start' | 'end' | null

/**
 * A two-handle range picker over the video's timeline, backed by editable
 * timestamps. Dragging is for "roughly here", typing is for "exactly here" —
 * both write the same range.
 */
export default function TrimEditor({ duration, value, onChange, hint }: Props): JSX.Element {
  const t = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Handle>(null)
  const [startText, setStartText] = useState(() => toClock(value.start ?? 0))
  const [endText, setEndText] = useState(() => (value.end != null ? toClock(value.end) : ''))

  const start = value.start ?? 0
  const end = value.end ?? duration
  const total = duration && duration > 0 ? duration : undefined
  const invalid = end != null && end <= start

  // Keep the text fields in sync when the range changes from the outside
  // (dragging a handle, or the "whole video" reset).
  useEffect(() => {
    if (dragging !== 'start') setStartText(toClock(value.start ?? 0))
    if (dragging !== 'end') setEndText(value.end != null ? toClock(value.end) : '')
  }, [value.start, value.end, dragging])

  const percentOf = useCallback(
    (seconds: number): number => (total ? Math.min(100, (seconds / total) * 100) : 0),
    [total]
  )

  const seek = useCallback(
    (clientX: number): number | undefined => {
      const track = trackRef.current
      if (!track || !total) return undefined
      const box = track.getBoundingClientRect()
      const ratio = (clientX - box.left) / Math.max(1, box.width)
      return clampTime(ratio * total, total)
    },
    [total]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent): void => {
      const seconds = seek(event.clientX)
      if (seconds == null) return
      if (dragging === 'start') {
        const upper = value.end ?? total ?? seconds
        onChange({ ...value, start: Math.min(seconds, Math.max(0, upper - 0.1)) })
      } else {
        onChange({ ...value, end: Math.max(seconds, (value.start ?? 0) + 0.1) })
      }
    }
    const onUp = (): void => setDragging(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, seek, onChange, value, total])

  const commitStart = (): void => {
    const parsed = parseClock(startText)
    if (parsed == null) {
      setStartText(toClock(start))
      return
    }
    onChange({ ...value, start: clampTime(parsed, total) })
  }

  const commitEnd = (): void => {
    if (!endText.trim()) {
      onChange({ ...value, end: undefined })
      return
    }
    const parsed = parseClock(endText)
    if (parsed == null) {
      setEndText(value.end != null ? toClock(value.end) : '')
      return
    }
    onChange({ ...value, end: clampTime(parsed, total) })
  }

  const lengthLabel = useMemo(() => {
    if (end == null) return null
    const length = end - start
    return length > 0 ? toClock(length) : null
  }, [start, end])

  return (
    <div className="space-y-3">
      {total != null && (
        <div
          ref={trackRef}
          className="relative h-9 cursor-pointer select-none rounded-xl bg-ink-900"
          onPointerDown={(e) => {
            const seconds = seek(e.clientX)
            if (seconds == null) return
            // Grab whichever handle is nearer to where the user pressed.
            const distStart = Math.abs(seconds - start)
            const distEnd = Math.abs(seconds - (end ?? total))
            if (distStart <= distEnd) {
              onChange({ ...value, start: clampTime(seconds, total) })
              setDragging('start')
            } else {
              onChange({ ...value, end: clampTime(seconds, total) })
              setDragging('end')
            }
          }}
        >
          <div
            className="absolute inset-y-0 rounded-xl bg-accent/25"
            style={{
              left: `${percentOf(start)}%`,
              width: `${Math.max(0, percentOf(end ?? total) - percentOf(start))}%`
            }}
          />
          {(['start', 'end'] as const).map((handle) => {
            const seconds = handle === 'start' ? start : (end ?? total)
            return (
              <div
                key={handle}
                role="slider"
                aria-label={handle === 'start' ? t('trim.start') : t('trim.end')}
                aria-valuenow={Math.round(seconds)}
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                tabIndex={0}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDragging(handle)
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 5 : 1
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    const delta = e.key === 'ArrowLeft' ? -step : step
                    const next = clampTime(seconds + delta, total)
                    if (handle === 'start') onChange({ ...value, start: next })
                    else onChange({ ...value, end: next })
                  }
                }}
                className="absolute top-1/2 z-10 h-7 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-ink-900 bg-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                style={{ left: `${percentOf(seconds)}%` }}
              />
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[92px] flex-1">
          <span className="mono mb-1 block text-[11px] uppercase tracking-wider text-fg/40">
            {t('trim.start')}
          </span>
          <input
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => e.key === 'Enter' && commitStart()}
            onFocus={() => setDragging(null)}
            placeholder="0:00"
            spellCheck={false}
            className="input mono px-3 py-2 text-sm"
          />
        </label>
        <label className="min-w-[92px] flex-1">
          <span className="mono mb-1 block text-[11px] uppercase tracking-wider text-fg/40">
            {t('trim.end')}
          </span>
          <input
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={(e) => e.key === 'Enter' && commitEnd()}
            onFocus={() => setDragging(null)}
            placeholder={total != null ? toClock(total) : t('trim.end.full')}
            spellCheck={false}
            className="input mono px-3 py-2 text-sm"
          />
        </label>
        <button
          className="btn-ghost px-3 py-2 text-xs"
          onClick={() => onChange({ start: 0, end: undefined })}
        >
          {t('trim.reset')}
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        {invalid ? (
          <span className="text-bad">{t('trim.invalid')}</span>
        ) : (
          <>
            {lengthLabel && (
              <span className="mono flex items-center gap-1.5 text-fg/50">
                <Scissors size={11} /> {t('trim.length')} {lengthLabel}
              </span>
            )}
            {hint && <span className="text-fg/35">{hint}</span>}
          </>
        )}
      </div>
    </div>
  )
}
