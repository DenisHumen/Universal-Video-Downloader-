import { motion } from 'framer-motion'
import { FileVideo, Globe, Link2, ListVideo, Scissors, Search } from 'lucide-react'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'

interface Capability {
  icon: JSX.Element
  title: TranslationKey
  body: TranslationKey
  action?: () => void
}

/**
 * The home screen's idle state. A list of supported logos tells you nothing
 * about what the app actually does; these cards say it plainly, and each one
 * is the entry point to the thing it describes.
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {items.map((item, i) => {
        const interactive = Boolean(item.action)
        const Tag = interactive ? 'button' : 'div'
        return (
          <Tag
            key={item.title}
            onClick={item.action}
            className={`flex items-start gap-3 rounded-2xl border border-fg/[0.06] bg-fg/[0.02] p-3.5 text-left transition-colors ${
              interactive ? 'no-drag cursor-pointer hover:border-accent/30 hover:bg-fg/[0.05]' : ''
            }`}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span className="mt-0.5 shrink-0 text-accent">{item.icon}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-cream">{t(item.title)}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-fg/40">
                {t(item.body)}
              </span>
            </span>
          </Tag>
        )
      })}
    </motion.div>
  )
}
