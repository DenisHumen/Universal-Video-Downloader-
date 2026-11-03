import type { SearchResult } from '@shared/types'
import { formatDuration } from '../../lib/format'
import { useT } from '../../i18n'
import { ActionRow, PreferencesGroup, Spinner } from '../../ui'
import Thumbnail from '../../components/Thumbnail'
import { serviceLabel } from '../../lib/services'
import type { UseInlineSearch } from './hooks'

interface Props {
  search: UseInlineSearch
  /** A result opens in the Download view's own card, as a pasted link would. */
  onPick: (result: SearchResult) => void
  /** "See All in Search": the query, in the Search view. */
  onSeeAll: (query: string) => void
}

/**
 * Plain text in the entry (5.4): the top few results right here, as rows,
 * and a way on to the rest. Searching waits for Enter or a 400 ms pause.
 */
export default function InlineSearch({ search, onPick, onSeeAll }: Props): JSX.Element | null {
  const t = useT()
  if (search.status === 'idle') return null
  const { status, results, query } = search
  return (
    <div aria-live="polite" aria-busy={status === 'searching'}>
      <PreferencesGroup title={t('home.searchResults', { query })}>
        {status === 'searching' && (
          <div className="ui-row justify-center">
            <Spinner size={16} label={t('home.searching')} />
          </div>
        )}
        {status === 'error' && <ActionRow title={t('search.failed')} />}
        {status === 'done' && results.length === 0 && <ActionRow title={t('search.nothing')} subtitle={t('search.nothingHint')} />}
        {status === 'done' &&
          results.map((r) => (
            <ActionRow
              key={`${r.service}-${r.id}`}
              title={<span className="line-clamp-1">{r.title}</span>}
              label={r.title}
              subtitle={[serviceLabel(r.service, t), r.uploader].filter(Boolean).join(' · ')}
              onActivate={() => onPick(r)}
              prefix={
                <span className="relative block h-9 w-16 overflow-hidden rounded-1 bg-sink">
                  <Thumbnail src={r.thumbnail} pageUrl={r.url} className="h-full w-full object-cover" fallback={<span className="block h-full w-full bg-sink" />} />
                  {r.duration != null && r.duration > 0 && (
                    <span className="numeric absolute bottom-0.5 right-0.5 rounded-1 bg-osd px-1 text-caption leading-tight text-osd-fg">
                      {formatDuration(r.duration)}
                    </span>
                  )}
                </span>
              }
            />
          ))}
        {status !== 'searching' && (
          <ActionRow title={t('home.seeAll')} navigation onActivate={() => onSeeAll(query)} />
        )}
      </PreferencesGroup>
    </div>
  )
}
