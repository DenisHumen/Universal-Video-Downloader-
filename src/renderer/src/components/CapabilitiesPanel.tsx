import { ArrowUpRight } from 'lucide-react'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'

interface Capability {
  title: TranslationKey
  body: TranslationKey
  action?: () => void
}

/**
 * The home screen's idle state: what this app can do, as a numbered index.
 *
 * Previously six bordered cards in a grid — six competing rectangles under an
 * input that was already the point of the screen. A ruled list carries the same
 * six facts with one hairline each, reads top-to-bottom like the reference
 * material it is, and the mono index gives the eye somewhere to land without
 * spending an icon on every row.
 */
export default function CapabilitiesPanel(): JSX.Element {
  const t = useT()
  const setView = useStore((s) => s.setView)

  const items: Capability[] = [
    { title: 'cap.link.title', body: 'cap.link.body' },
    { title: 'cap.search.title', body: 'cap.search.body', action: () => setView('search') },
    { title: 'cap.trim.title', body: 'cap.trim.body' },
    { title: 'cap.convert.title', body: 'cap.convert.body', action: () => setView('downloads') },
    { title: 'cap.channel.title', body: 'cap.channel.body' },
    { title: 'cap.browser.title', body: 'cap.browser.body', action: () => void window.api.openBrowser() }
  ]

  return (
    <section>
      <p className="label mb-1">{t('cap.title')}</p>
      <ul className="border-t border-edge">
        {items.map((item, i) => {
          const interactive = Boolean(item.action)
          return (
            <li key={item.title} className="border-b border-edge">
              <div
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={item.action}
                onKeyDown={(e) => {
                  if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    item.action?.()
                  }
                }}
                className={`group flex items-start gap-4 py-3.5 transition-colors duration-fast ease-ease ${
                  interactive
                    ? 'no-drag cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                    : ''
                }`}
              >
                <span className="mono w-6 shrink-0 pt-0.5 text-[11px] tabular-nums text-ink-3">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`text-[13px] font-medium text-ink ${
                        interactive ? 'group-hover:text-accent-ink' : ''
                      }`}
                    >
                      {t(item.title)}
                    </span>
                    {interactive && (
                      <ArrowUpRight
                        size={13}
                        className="shrink-0 text-ink-3 transition-colors duration-fast ease-ease group-hover:text-accent-ink"
                      />
                    )}
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-ink-2">
                    {t(item.body)}
                  </span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
