import type { AppErrorCode } from '@shared/types'
import { useT } from '../i18n'
import { helpForError } from '../lib/help'
import { useStore } from '../store'

/** "How do I fix this?" beside a failure whose fix wants explaining, and nothing beside one that does not. */
export default function HelpLink({ errorCode, cookieHint }: { errorCode?: AppErrorCode; cookieHint?: boolean }): JSX.Element | null {
  const t = useT()
  const topic = helpForError(errorCode, cookieHint)
  if (!topic) return null
  return (
    <button
      type="button"
      className="no-drag rounded-1 px-1 text-meta text-ink-2 underline transition-colors duration-fast ease-ease hover:text-ink"
      data-help={topic}
      onClick={() => useStore.getState().openHelp(topic)}
    >
      {t('help.howToFix')}
    </button>
  )
}
