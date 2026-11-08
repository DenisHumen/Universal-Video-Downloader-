import { useMemo } from 'react'
import type { AppSettings, MediaInfo } from '@shared/types'
import { MAX_SUBTITLE_LANGUAGES } from '@shared/languages'
import { languageName, subtitleChoices } from '../../lib/languages'
import { resolveLanguage, useT } from '../../i18n'
import { useStore } from '../../store'
import { ExpanderRow, cx } from '../../ui'

interface Props {
  info: Pick<MediaInfo, 'subtitleLanguages' | 'autoCaptionLanguages'>
  settings: AppSettings
  /** The languages picked; absent leaves it to Settings. */
  value: string[] | undefined
  onChange: (next: string[] | undefined) => void
}

/**
 * Which subtitles to fetch, for this video.
 *
 * Named languages only, and a handful at most. There is deliberately no "all":
 * on YouTube that means every language it can translate to, and it answers that
 * many requests with a 429 and no video.
 */
export default function SubtitlesRow({ info, settings, value, onChange }: Props): JSX.Element | null {
  const t = useT()
  const locale = useStore((s) => resolveLanguage(s.settings?.language ?? 'auto', s.appInfo?.locale ?? 'en'))
  const { written, automatic } = useMemo(() => subtitleChoices(info, locale, t), [info, locale, t])
  if (!written.length && !automatic.length) return null

  const picked = value ?? []
  const full = picked.length >= MAX_SUBTITLE_LANGUAGES
  const toggle = (code: string): void => {
    const next = picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]
    onChange(next.length ? next : undefined)
  }
  const summary = picked.length
    ? picked.map((code) => languageName(code, locale, t)).join(', ')
    : settings.embedSubtitles || settings.writeSubtitles
      ? t('format.subtitlesSettings', { languages: settings.subtitleLanguages })
      : t('format.subtitlesNone')

  const group = (label: string, list: { code: string; label: string }[]): JSX.Element | null =>
    list.length ? (
      <div>
        <p className="label mb-2">{label}</p>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {list.map(({ code, label: name }) => {
            const on = picked.includes(code)
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                disabled={full && !on}
                onClick={() => toggle(code)}
                className={cx(
                  'no-drag rounded-1 border px-2.5 py-1 text-control transition-colors duration-fast ease-ease disabled:opacity-50',
                  on ? 'border-accent bg-accent text-accent-fg' : 'border-edge text-ink-2 hover:border-ink-3 hover:text-ink'
                )}
              >
                {name}
              </button>
            )
          })}
        </div>
      </div>
    ) : null

  return (
    <ExpanderRow
      id="result-subtitles"
      title={t('format.subtitlesTitle')}
      subtitle={summary}
      expandLabel={t('format.subtitlesTitle')}
    >
      <div className="space-y-4 p-3">
        {group(t('format.subtitlesFromSite'), written)}
        {group(t('format.subtitlesAutomatic'), automatic)}
      </div>
    </ExpanderRow>
  )
}
