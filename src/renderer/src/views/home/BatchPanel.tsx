import { useMemo, useState } from 'react'
import { m } from 'framer-motion'
import { collapse } from '../../lib/motion'
import { Folder, Loader2 } from '../../ui/icons'
import type { AppSettings, DownloadMode, QualityPreset } from '@shared/types'
import { QUALITY_HEIGHTS, heightLabel, initialMode, initialQuality } from '../../lib/quality'
import { queueDownloads } from '../../lib/queue'
import { parseBatch } from '../../lib/batch'
import { useT, useTp } from '../../i18n'
import { ActionRow, ComboRow, PreferencesGroup } from '../../ui'

interface Props {
  id: string
  text: string
  onText: (text: string) => void
  settings: AppSettings | null
  saveDir: string
  onSaveDir: (dir: string) => void
  /** Everything queued: the panel closes and empties. */
  onQueued: () => void
}

/**
 * The same entry in batch mode (5.4, A1.1 §3): one link per line, each line
 * checked, repeats dropped, and one choice of format, quality and folder for
 * the lot. Its button is the screen's only primary while it is open.
 */
export default function BatchPanel({ id, text, onText, settings, saveDir, onSaveDir, onQueued }: Props): JSX.Element {
  const t = useT()
  const tp = useTp()
  const parsed = useMemo(() => parseBatch(text), [text])
  const [mode, setMode] = useState<DownloadMode>(() => initialMode(settings))
  const [quality, setQuality] = useState<QualityPreset>(() => (initialMode(settings) === 'audio' ? 'best' : initialQuality(settings)))
  const [starting, setStarting] = useState(false)

  const queue = async (): Promise<void> => {
    if (!parsed.links.length) return
    setStarting(true)
    let ok = false
    try {
      ok = await queueDownloads(
        parsed.links.map((link) => ({
          url: link,
          title: link,
          mode,
          quality: mode === 'audio' ? 'audio' : quality,
          outputDir: saveDir || undefined
        }))
      )
    } finally {
      setStarting(false)
    }
    if (ok) onQueued()
  }

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) onSaveDir(dir)
  }

  const checks = [
    parsed.links.length ? tp('home.batchValid', parsed.links.length) : null,
    parsed.duplicates ? tp('home.batchDuplicates', parsed.duplicates) : null,
    parsed.invalid.length ? tp('home.batchInvalid', parsed.invalid.length) : null
  ].filter(Boolean)

  return (
    <m.div {...collapse} id={id} className="overflow-hidden">
      <div className="mt-4 space-y-4">
        <PreferencesGroup title={t('home.batch')} description={t('home.batchHint')}>
          <div className="p-3">
            <textarea
              value={text}
              onChange={(e) => onText(e.target.value)}
              rows={5}
              aria-label={t('home.batchHint')}
              aria-describedby={`${id}-checks`}
              spellCheck={false}
              className="field mono w-full resize-none text-control"
              placeholder={'https://…\nhttps://…'}
            />
            <p id={`${id}-checks`} className="numeric mt-2 text-meta text-ink-2" aria-live="polite">
              {checks.join(' · ')}
            </p>
          </div>
        </PreferencesGroup>
        <PreferencesGroup>
          <ComboRow
            title={t('common.format')}
            value={mode}
            onChange={(v) => setMode(v as DownloadMode)}
            options={[
              { value: 'video', label: t('common.video') },
              { value: 'audio', label: t('common.audioOnly') }
            ]}
          />
          {mode === 'video' && (
            <ComboRow
              title={t('common.quality')}
              value={quality}
              onChange={(v) => setQuality(v as QualityPreset)}
              options={[
                { value: 'best', label: t('common.best') },
                ...QUALITY_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) }))
              ]}
            />
          )}
          <ActionRow
            title={t('home.saveTo')}
            subtitle={saveDir || settings?.downloadDir || ''}
            monoSubtitle
            suffix={
              <>
                {saveDir && (
                  <button type="button" className="btn-quiet" onClick={() => onSaveDir('')}>
                    {t('home.saveDefault')}
                  </button>
                )}
                <button type="button" className="btn-quiet" onClick={() => void chooseDir()}>
                  <Folder size={14} /> {t('common.change')}
                </button>
              </>
            }
          />
        </PreferencesGroup>
        <div className="flex justify-center">
          <button
            type="button"
            className="btn-solid h-11 min-w-[60%] max-w-full rounded-pill px-8 text-body"
            disabled={!parsed.links.length || starting}
            onClick={() => void queue()}
          >
            {starting ? <Loader2 size={15} className="animate-spin" /> : null}
            {tp('home.batchAdd', parsed.links.length)}
          </button>
        </div>
      </div>
    </m.div>
  )
}
