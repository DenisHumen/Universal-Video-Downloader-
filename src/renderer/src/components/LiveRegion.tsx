import { useEffect, useRef, useState } from 'react'
import type { DownloadItem } from '@shared/types'
import { useStore } from '../store'
import { errorText } from '../lib/errors'
import { useT } from '../i18n'

/** States worth interrupting someone for. Progress is not one of them. */
const ANNOUNCED: DownloadItem['state'][] = ['completed', 'error']

/**
 * Speaks download outcomes to screen readers.
 *
 * A download finishes minutes after it was started, usually while the user is
 * on another screen or in another app — the two things the app currently used
 * to say so were a toast that fades and a coloured dot, neither of which
 * reaches anyone who isn't looking at the window. This is the same information
 * as text, in a polite live region, so it is read out when the reader is next
 * idle rather than cutting across whatever is being read now.
 *
 * Only terminal states are announced. Announcing progress would mean speaking
 * over the user several times a second.
 */
export default function LiveRegion(): JSX.Element {
  const t = useT()
  const downloads = useStore((s) => s.downloads)
  const ready = useStore((s) => s.ready)
  const [message, setMessage] = useState('')
  /** Last state seen per id, so we announce transitions rather than presence. */
  const seen = useRef(new Map<string, DownloadItem['state']>())
  /**
   * Skip everything that was already there when the app opened.
   *
   * The intent was always this, but the flag was set on the very first effect
   * run — which happens at mount, while the list is still the empty array the
   * store starts with. The restored history arrived a tick later, found the
   * component already primed and nothing in `seen`, and so every completed and
   * failed download the user had ever made was read out on launch: exactly
   * what this was written to prevent.
   *
   * `ready` is the store's own signal that the first load has landed.
   */
  const primed = useRef(false)

  useEffect(() => {
    // Nothing to compare against until the restored list is in.
    if (!ready) return

    const next = new Map<string, DownloadItem['state']>()
    const fresh: string[] = []

    for (const item of downloads) {
      next.set(item.id, item.state)
      if (!primed.current) continue
      if (seen.current.get(item.id) === item.state) continue
      if (!ANNOUNCED.includes(item.state)) continue
      fresh.push(
        item.state === 'completed'
          ? t('a11y.downloadFinished', { title: item.title })
          : t('a11y.downloadFailed', { title: item.title, error: errorText(t, item) })
      )
    }

    seen.current = next
    primed.current = true
    if (fresh.length) setMessage(fresh.join('. '))
  }, [downloads, ready, t])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
