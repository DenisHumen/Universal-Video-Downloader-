import { ArrowUpRight, FileVideo, Globe, Link2, ListVideo, Scissors, Search } from 'lucide-react'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'

interface Capability {
  icon: JSX.Element
  title: TranslationKey
  body: TranslationKey
  action?: () => void
}

/**
 * The home screen's idle state: what this app can do, as a ruled list.
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
    { icon: <Link2 size={16} />, title: 'cap.link.title', body: 'cap.link.body' },
    {
      icon: <Search size={16} />,
      title: 'cap.search.title',
      body: 'cap.search.body',
      action: () => setView('search')
    },
    { icon: <Scissors size={16} />, title: 'cap.trim.title', body: 'cap.trim.body' },
    {
      icon: <FileVideo size={16} />,
      title: 'cap.convert.title',
      body: 'cap.convert.body',
      action: () => setView('downloads')
    },
    { icon: <ListVideo size={16} />, title: 'cap.channel.title', body: 'cap.channel.body' },
    {
      icon: <Globe size={16} />,
      title: 'cap.browser.title',
      body: 'cap.browser.body',
      action: () => void window.api.openBrowser()
    }
  ]

  return (
    <section>
      <p className="label mb-1">{t('cap.title')}</p>
      <ul className="border-t border-edge">
        {items.map((item) => {
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
                className={`group flex items-start gap-3.5 py-3.5 transition-colors duration-fast ease-ease ${
                  interactive
                    ? 'no-drag cursor-pointer outline-offset-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
                    : ''
                }`}
              >
                {/* An icon, not just an index: it is recognised before the
                    heading is read, which is what makes a list of six things
                    scannable rather than six paragraphs to work through. */}
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-1 bg-sink text-ink-2">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`text-[14px] font-medium text-ink ${
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
                  <span className="hint mt-1 block">{t(item.body)}</span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
