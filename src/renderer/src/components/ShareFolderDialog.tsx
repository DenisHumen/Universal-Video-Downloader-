import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '../ui/Dialog'
import { ActionRow } from '../ui/Rows'
import { Spinner } from '../ui/Status'
import { ArrowUp, ChevronRight, Folder, Loader2, Plus } from '../ui/icons'
import { useT } from '../i18n'
import { describeError } from '../lib/errors'
import type { SmbTarget } from '@shared/automation'

/**
 * GtkFileChooser's folder mode, over the app's own SMB connection.
 *
 * The system dialog only sees a share the OS has mounted. Once the server,
 * the share and a login are known the app can walk the share itself, so this
 * is the browser for everybody else: a path bar of crumbs, the folders here as
 * a boxed list of rows that open, and Select for the folder on screen.
 */
export default function ShareFolderDialog({
  target,
  password,
  onPick,
  onClose
}: {
  target: SmbTarget
  /** The password being typed; empty means the stored one. */
  password: string
  /** The folder chosen, share-relative and '/'-joined ('' for the share itself). */
  onPick: (folder: string) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const [parts, setParts] = useState<string[]>(() => (target.path ?? '').split(/[\\/]+/).filter(Boolean))
  const [folders, setFolders] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const folder = parts.join('/')

  /*
    A folder that was typed but does not exist yet answers "not found". Step
    back to the nearest one that does, rather than opening on an error - the
    first time through, only; after that a failure is worth showing.
  */
  const first = useRef(true)
  const load = useCallback(
    async (at: string[]): Promise<void> => {
      setFolders(null)
      setError('')
      try {
        setFolders(await window.api.autoListShareFolders(target, password, at.join('/')))
        first.current = false
      } catch (err) {
        if (first.current && at.length) {
          setParts(at.slice(0, -1))
          return
        }
        first.current = false
        setError(describeError(err))
      }
    },
    [target, password]
  )

  useEffect(() => {
    void load(parts)
    // Reloads when the folder changes, not when the parent re-renders the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  useEffect(() => {
    if (creating) nameRef.current?.focus()
  }, [creating])

  const go = (next: string[]): void => {
    setCreating(false)
    setName('')
    setParts(next)
  }

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const made = await window.api.autoCreateShareFolder(target, password, folder, name)
      go(made.split('/').filter(Boolean))
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const crumbs = [target.share, ...parts]

  return (
    <Dialog
      variant="sheet"
      size="md"
      title={t('auto.shareFolderTitle')}
      subtitle={`\\\\${target.host}\\${target.share}`}
      closeLabel={t('common.close')}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-solid" onClick={() => onPick(folder)} disabled={folders === null}>
            {t('auto.shareFolderSelect')}
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-1.5">
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-md shrink-0"
          aria-label={t('auto.shareFolderUp')}
          title={t('auto.shareFolderUp')}
          disabled={!parts.length}
          onClick={() => go(parts.slice(0, -1))}
        >
          <ArrowUp size={16} />
        </button>
        <nav aria-label={t('auto.shareFolderPath')} className="min-w-0 flex-1 overflow-x-auto">
          <ol className="flex items-center gap-0.5 whitespace-nowrap text-body">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1
              return (
                <li key={i} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight size={12} className="shrink-0 text-ink-3" aria-hidden="true" />}
                  <button
                    type="button"
                    className={last ? 'btn-quiet font-semibold' : 'btn-quiet'}
                    aria-current={last ? 'location' : undefined}
                    onClick={() => go(parts.slice(0, i))}
                  >
                    {crumb}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <button
          type="button"
          className="ui-icon-btn ui-icon-btn-md shrink-0"
          aria-label={t('auto.shareFolderNew')}
          title={t('auto.shareFolderNew')}
          aria-pressed={creating}
          disabled={folders === null && !error}
          onClick={() => setCreating((c) => !c)}
        >
          <Plus size={16} />
        </button>
      </div>

      {creating && (
        <form
          className="mb-3 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('auto.shareFolderName')}
            aria-label={t('auto.shareFolderName')}
            className="field w-full min-w-0 text-control"
            spellCheck={false}
          />
          <button type="submit" className="btn-solid shrink-0" disabled={!name.trim() || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('auto.shareFolderCreate')}
          </button>
        </form>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 text-meta text-bad">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" className="btn-quiet shrink-0" onClick={() => void load(parts)}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {folders === null && !error ? (
        <div className="flex min-h-[160px] items-center justify-center">
          <Spinner size={24} label={t('auto.shareFolderLoading')} />
        </div>
      ) : folders && folders.length ? (
        <div className="ui-boxed-list max-h-[320px] overflow-y-auto" role="list" aria-label={t('auto.shareFolderList')}>
          {folders.map((name) => (
            <div role="listitem" key={name}>
              <ActionRow
                title={name}
                prefix={<Folder size={16} />}
                navigation
                onActivate={() => go([...parts, name])}
              />
            </div>
          ))}
        </div>
      ) : folders ? (
        <p className="flex min-h-[120px] items-center justify-center text-body text-ink-2">
          {t('auto.shareFolderEmpty')}
        </p>
      ) : null}
    </Dialog>
  )
}
