import type { DownloadItem } from '@shared/types'
import type { TranslationKey } from '../i18n'

/** How each queue state is named and coloured, wherever a job is drawn. */
export const STATE_META: Record<
  DownloadItem['state'],
  { label: TranslationKey; dot: string; text: string }
> = {
  queued: { label: 'state.queued', dot: 'bg-edge-strong', text: 'text-ink-3' },
  detecting: { label: 'state.detecting', dot: 'bg-warn', text: 'text-warn' },
  downloading: { label: 'state.downloading', dot: 'bg-accent', text: 'text-accent-ink' },
  processing: { label: 'state.processing', dot: 'bg-accent', text: 'text-accent-ink' },
  completed: { label: 'state.completed', dot: 'bg-good', text: 'text-good' },
  error: { label: 'state.error', dot: 'bg-bad', text: 'text-bad' },
  paused: { label: 'state.paused', dot: 'bg-edge-strong', text: 'text-ink-3' },
  canceled: { label: 'state.canceled', dot: 'bg-edge-strong', text: 'text-ink-3' }
}
