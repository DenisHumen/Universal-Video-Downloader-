import { useEffect, useMemo } from 'react'
import HelpText from '../components/HelpText'
import { useT } from '../i18n'
import { HELP_TOPICS, helpPlain, helpSearchText, type HelpAction, type HelpTopic } from '../lib/help'
import { matchesQuery } from '../lib/settingsSearch'
import { toast } from '../lib/toast'
import { useStore } from '../store'
import { useKept } from '../hooks/useKept'
import { BOOKMARKLET } from '@shared/sent-link'
import { ExpanderRow, PreferencesGroup, PreferencesPage } from '../ui'
import { Search } from '../ui/icons'

/**
 * Help (a boxed list of questions, each folding open to its answer): the page
 * for someone who does not know what to ask for yet, so it reads like questions
 * and every answer ends in a button that goes there. All of it ships with the
 * app; it needs no network, which is when a person may well be reading it.
 */
export default function HelpView(): JSX.Element {
  const t = useT()
  const topic = useStore((s) => s.helpTopic)
  const request = useStore((s) => s.helpRequest)
  const [query, setQuery] = useKept('kept:help.query', '')

  const shown = useMemo(
    () => HELP_TOPICS.filter((h) => matchesQuery(query, helpSearchText(h, t))),
    [query, t]
  )
  const searching = Boolean(query.trim())

  // Asked for from an error or the palette: the reader should not have to find it again.
  useEffect(() => {
    if (topic) document.getElementById(`help-${topic}`)?.scrollIntoView?.({ block: 'center' })
  }, [topic, request])

  return (
    <div className="h-full overflow-y-auto">
      <PreferencesPage>
        <label className="field flex cursor-text items-center gap-2">
          <Search size={16} className="shrink-0 text-ink-2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('help.search')}
            aria-label={t('help.search')}
            className="no-drag min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink/80"
            spellCheck={false}
          />
        </label>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-body text-ink-2">{t('help.noMatch')}</p>
        ) : (
          <PreferencesGroup description={t('help.lead')}>
            {shown.map((h) => {
              const asked = topic === h.id
              return (
                <ExpanderRow
                  /* Remounted by a new request or a new search: that is what opens it. */
                  key={`${h.id}:${asked ? request : 0}:${searching}`}
                  id={`help-${h.id}`}
                  prefix={<h.icon size={16} />}
                  title={helpPlain(t(h.title), t)}
                  subtitle={helpPlain(t(h.summary), t)}
                  expandLabel={helpPlain(t(h.title), t)}
                  defaultExpanded={asked || searching}
                >
                  <Answer topic={h} />
                </ExpanderRow>
              )
            })}
          </PreferencesGroup>
        )}
      </PreferencesPage>
    </div>
  )
}

function Answer({ topic }: { topic: HelpTopic }): JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3 py-3 pr-4 text-body text-ink">
      {topic.paragraphs?.map((key) => (
        <p key={key}>
          <HelpText text={t(key)} />
        </p>
      ))}
      {topic.steps && (
        <ol className="space-y-2">
          {topic.steps.map((key, i) => (
            <li key={key} className="flex gap-2.5">
              <span className="mono w-4 shrink-0 text-right tabular-nums text-ink-2" aria-hidden="true">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <HelpText text={t(key)} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {topic.note && (
        <p className="text-meta text-ink-2">
          <HelpText text={t(topic.note)} />
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {topic.actions.map((action, i) => (
          <ActionButton key={i} action={action} />
        ))}
      </div>
    </div>
  )
}

/** The steps for the extension, in the repository: it is not on any store, and that page can say so when it is. */
const EXTENSION_GUIDE = 'https://github.com/DenisHumen/Universal-Video-Downloader/tree/main/browser-extension#readme'

function ActionButton({ action }: { action: HelpAction }): JSX.Element {
  const t = useT()
  const s = useStore.getState()
  const [label, run]: [string, () => void] = ((): [string, () => void] => {
    switch (action.kind) {
      case 'view':
        return [t('help.goTo', { name: t(action.name) }), () => s.setView(action.view)]
      case 'settings':
        return [t('help.goTo', { name: t(action.name) }), () => s.openSettings(action.route)]
      case 'browser':
        return [t('browser.open'), () => void window.api.openBrowser()]
      case 'downloadsFolder':
        return [
          t('palette.openFolder'),
          () => {
            const dir = useStore.getState().settings?.downloadDir
            if (dir) void window.api.openPath(dir)
          }
        ]
      case 'addWatch':
        return [t('auto.addTitle'), () => s.requestWatch({ url: '' })]
      case 'topic': {
        const topic = HELP_TOPICS.find((h) => h.id === action.topic)!
        return [helpPlain(t(topic.title), t), () => s.openHelp(action.topic)]
      }
      case 'extensionGuide':
        return [t('help.send.guide'), () => void window.api.openExternal(EXTENSION_GUIDE)]
      case 'copyBookmarklet':
        return [
          t('help.send.copyBookmarklet'),
          () =>
            void navigator.clipboard.writeText(BOOKMARKLET).then(
              () => toast(t('common.copied'), 'success'),
              () => undefined
            )
        ]
    }
  })()
  return (
    <button type="button" className="btn-quiet" onClick={run}>
      {label}
    </button>
  )
}
