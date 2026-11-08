import { useEffect, useState } from 'react'
import type { ShareSendResult } from '@shared/types'
import { useT, type TranslationKey } from '../i18n'
import { formatBytes } from '../lib/format'
import { toast } from '../lib/toast'
import { useStore } from '../store'
import { Dropdown } from '../ui'
import Dialog from '../ui/Dialog'
import ConfirmDialog from './ConfirmDialog'
import ShareFolderDialog from './ShareFolderDialog'

type FailedKind = Extract<ShareSendResult, { status: 'failed' }>['kind']

/* `unknown` shows the server's own words: there is nothing better to say about it. */
const FAILURE: Record<Exclude<FailedKind, 'unknown'>, TranslationKey> = {
  auth: 'send.failAuth',
  network: 'send.failNetwork',
  path: 'send.failPath',
  full: 'send.failFull',
  busy: 'send.failBusy',
  noTarget: 'send.failNoTarget',
  noPassword: 'send.failNoPassword',
  noFile: 'send.failNoFile'
}

interface Props {
  /** The queue row or Library entry; main finds the file from it. */
  id: string
  title: string
  onClose: () => void
}

/**
 * Send one finished file to a share set up in Settings.
 *
 * Closing while it sends only closes this: the upload carries on in main and the
 * toast still says how it went. A name already taken on the share comes back
 * before anything is changed, and goes no further unless somebody says Replace.
 */
export default function SendToShareDialog({ id, title, onClose }: Props): JSX.Element {
  const t = useT()
  const targets = useStore((s) => s.settings?.smbTargets) ?? []
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const target = targets.find((x) => x.id === targetId)
  const [folder, setFolder] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ bytes: number; total: number } | null>(null)
  const [taken, setTaken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const where = folder ?? (target?.path ?? '').split(/[\\/]+/).filter(Boolean).join('/')

  useEffect(
    () =>
      window.api.onShareSendProgress((p) => {
        if (p.id === id) setSent({ bytes: p.bytes, total: p.total })
      }),
    [id]
  )

  const send = async (replace: boolean): Promise<void> => {
    setSending(true)
    setSent(null)
    setError('')
    setTaken(null)
    const result = await window.api
      .shareSend({ id, targetId, folder: where, replace })
      .catch((err: unknown): ShareSendResult => ({ status: 'failed', kind: 'unknown', message: String(err) }))
    setSending(false)
    if (result.status === 'sent') {
      toast(t('send.done', { path: result.remotePath }), 'success')
      onClose()
    } else if (result.status === 'exists') {
      setTaken(result.name)
    } else {
      const text = result.kind === 'unknown' ? result.message : t(FAILURE[result.kind])
      setError(text)
      toast(text, 'error')
    }
  }

  const percent = sent && sent.total ? Math.min(100, Math.round((sent.bytes / sent.total) * 100)) : 0

  return (
    <>
      <Dialog
        variant="sheet"
        size="md"
        title={t('send.title')}
        subtitle={title}
        closeLabel={t('common.close')}
        onClose={onClose}
        actions={
          <>
            <button type="button" className="btn-quiet" onClick={onClose}>
              {sending ? t('common.close') : t('common.cancel')}
            </button>
            <button type="button" className="btn-solid" disabled={sending || !target} onClick={() => void send(false)}>
              {t('send.button')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {targets.length > 1 && (
            <Dropdown
              variant="field"
              aria-label={t('send.share')}
              value={targetId}
              options={targets.map((x) => ({ value: x.id, label: x.name || `${x.host}/${x.share}` }))}
              disabled={sending}
              onChange={(next) => {
                setTargetId(next)
                setFolder(null)
              }}
            />
          )}
          <div className="flex items-center gap-2">
            <p className="mono min-w-0 flex-1 truncate text-meta text-ink-2" title={where}>
              {target ? `${target.share}/${where}` : ''}
            </p>
            <button type="button" className="btn-quiet shrink-0" disabled={sending || !target} onClick={() => setBrowsing(true)}>
              {t('send.chooseFolder')}
            </button>
          </div>
          {sending && (
            <div>
              <div
                className="h-[3px] overflow-hidden rounded-pill bg-sink"
                role="progressbar"
                aria-label={t('send.sending')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="h-full bg-accent-bright transition-[width] duration-base ease-ease" style={{ width: `${percent}%` }} />
              </div>
              <p className="numeric mt-1 text-meta text-ink-2">
                {t('send.sending')}
                {sent ? ` · ${formatBytes(sent.bytes)} / ${formatBytes(sent.total)}` : ''}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-meta text-bad">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      {browsing && target && (
        <ShareFolderDialog
          target={{ ...target, path: where }}
          password=""
          onClose={() => setBrowsing(false)}
          onPick={(picked) => {
            setFolder(picked)
            setBrowsing(false)
          }}
        />
      )}
      {taken && (
        <ConfirmDialog
          title={t('send.takenTitle')}
          body={t('send.takenBody', { name: taken })}
          confirmLabel={t('send.replace')}
          onCancel={() => setTaken(null)}
          onConfirm={() => void send(true)}
        />
      )}
    </>
  )
}
