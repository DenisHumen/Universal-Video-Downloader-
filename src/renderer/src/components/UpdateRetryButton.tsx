import { useEffect, useState } from 'react'
import { Download, Loader2 } from '../ui/icons'
import { siteMayHaveChanged } from '@shared/engine-version'
import type { AppErrorCode } from '@shared/types'
import { useT } from '../i18n'
import { toast } from '../lib/toast'

/**
 * "Update and Retry", for a failure that looks like the site having changed while
 * a newer engine than this one is out: the one fix a person could not have found
 * by looking at the failed row. Asks only about failures of that kind, and shows
 * nothing unless the answer is yes. The update is the same one Settings runs, with
 * the same checks, and is refused the same way while something is downloading.
 */
export default function UpdateRetryButton({
  errorCode,
  said,
  solid = false,
  onRetry
}: {
  errorCode?: AppErrorCode
  /** The failure's own words, for one with no code. */
  said?: string
  solid?: boolean
  onRetry: () => void
}): JSX.Element | null {
  const t = useT()
  const [older, setOlder] = useState(false)
  const [updating, setUpdating] = useState(false)
  const applies = siteMayHaveChanged(errorCode, said)

  useEffect(() => {
    if (!applies) {
      setOlder(false)
      return
    }
    let live = true
    void window.api
      .engineFreshness()
      .then((answer) => live && setOlder(answer.older))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [applies])

  if (!older) return null

  const run = async (): Promise<void> => {
    setUpdating(true)
    try {
      const res = await window.api.updateYtdlp()
      if (res.ok) {
        // Nothing older to offer now, whatever the retry comes to.
        setOlder(false)
        onRetry()
      } else {
        toast(res.code === 'engineBusy' ? t('err.engineBusy') : t('settings.engineFailed'), 'error')
      }
    } catch {
      toast(t('settings.engineFailed'), 'error')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <button type="button" className={solid ? 'btn-solid' : 'btn-quiet'} data-fix="updateRetry" disabled={updating} onClick={() => void run()}>
      {updating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {t('fix.updateRetry')}
    </button>
  )
}
