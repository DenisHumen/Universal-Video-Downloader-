import { ArrowDownToLine } from 'lucide-react'
import { useT } from '../i18n'

/**
 * The whole window, outlined, while a link is dragged over it.
 *
 * Dropping a link anywhere has always worked - usePasteDetect takes it on
 * every screen - and nothing on screen ever said so, so nobody tried it. The
 * frame answers "can I drop this here?" the moment the drag enters. It takes
 * no pointer events: the drop lands on the window underneath it, where the
 * one handler for it already lives.
 */
export default function DropOverlay(): JSX.Element {
  const t = useT()
  return (
    <div
      className="pointer-events-none fixed inset-2 flex items-center justify-center rounded-3 border-2 border-dashed border-accent bg-accent/[0.06]"
      style={{ zIndex: 'var(--z-overlay)' }}
      aria-hidden="true"
    >
      <p className="flex items-center gap-2 rounded-3 bg-raise px-4 py-2 text-body font-medium text-ink">
        <ArrowDownToLine size={16} className="text-accent-ink" />
        {t('home.dropHint')}
      </p>
    </div>
  )
}
