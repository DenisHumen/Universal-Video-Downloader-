import { Folder } from 'lucide-react'
import { useT } from '../i18n'

interface Props {
  /** The folder picked for this job, or '' for the one in Settings. */
  value: string
  onChange: (dir: string) => void
  /** The folder in Settings, shown while nothing else is picked. */
  defaultDir: string
  /** Spacing and rules from the surface it sits on. */
  className?: string
}

/**
 * Where the job on screen will be saved, and the way to change it.
 *
 * Every Home surface that queues something sends `outputDir`, so every one
 * of them shows this above its button. Only the single-video card used to:
 * playlists and series - the largest jobs - could not choose a folder at all,
 * while the batch panel quietly sent whatever folder had last been picked for
 * a different video, without the screen ever mentioning it.
 */
export default function SaveLocation({ value, onChange, defaultDir, className = '' }: Props): JSX.Element {
  const t = useT()

  const choose = async (): Promise<void> => {
    const dir = await window.api.chooseDirectory()
    if (dir) onChange(dir)
  }

  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <p className="label mb-1.5">{t('settings.saveLocation')}</p>
        <p className="mono truncate text-[12px] text-ink-2" title={value || defaultDir}>
          {value || defaultDir}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {value && (
          <button className="btn-quiet" onClick={() => onChange('')}>
            {t('home.saveDefault')}
          </button>
        )}
        <button className="btn-quiet" onClick={() => void choose()}>
          <Folder size={14} /> {t('common.change')}
        </button>
      </div>
    </div>
  )
}
