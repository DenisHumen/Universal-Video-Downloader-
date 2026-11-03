import type { LanguageId } from '@shared/types'
import { useStore } from '../store'
import { useT, type TranslationKey } from '../i18n'
import { overallPercent } from '../lib/downloads'
import Logo from '../components/Logo'
import { IconButton, Menu, Tooltip, cx } from '../ui'
import { Check, Globe, Keyboard, Languages } from '../ui/icons'
import { NAV_BOTTOM, NAV_MAIN, type NavSection } from './nav'

const ACTIVE_STATES = ['downloading', 'processing', 'queued', 'paused', 'detecting']

interface Props {
  /** The platform, from the preload (appInfo), never `process.platform`: tests render it as each OS. */
  platform: NodeJS.Platform | undefined
  /** Below 1000 px the sidebar is a 56 px icon rail with tooltips. */
  rail: boolean
}

/**
 * The 4.0 sidebar (plan 4.2): 220 px of navigation on the window canvas, or a
 * 56 px rail on a narrow window. Its top is part of the window's drag region;
 * on macOS that is also where the traffic lights sit, so it is left empty
 * there. The footer carries what the 3.x title bar did: engine state, overall
 * progress, language, the built-in browser and the shortcut list.
 */
export default function Sidebar({ platform, rail }: Props): JSX.Element {
  const t = useT()
  const isMac = platform === 'darwin'

  return (
    <div
      className={cx('flex shrink-0 flex-col bg-canvas', rail ? 'w-14' : 'w-[220px]')}
      style={{ zIndex: 'var(--z-nav)' }}
      data-rail={rail || undefined}
    >
      {/* The window is dragged from here; the traffic lights live here on a Mac. */}
      <div
        className={cx('drag-region flex shrink-0 items-center', isMac ? 'h-[52px]' : 'h-12', rail ? 'justify-center' : 'px-4')}
        data-uvd="sidebar-drag"
      >
        {!isMac && (
          <span className="flex items-center gap-2.5 text-ink">
            <Logo className="h-[18px] w-[18px]" />
            {!rail && <span className="text-control font-semibold tracking-wide">UVD</span>}
          </span>
        )}
      </div>

      <nav aria-label={t('nav.label')} className={cx('flex min-h-0 flex-1 flex-col gap-0.5 pt-1', rail ? 'px-2' : 'px-3')}>
        {NAV_MAIN.map((s) => (
          <NavItem key={s.id} section={s} rail={rail} />
        ))}
        <div className="flex-1" />
        {NAV_BOTTOM.map((s) => (
          <NavItem key={s.id} section={s} rail={rail} />
        ))}
      </nav>

      <Footer rail={rail} />
    </div>
  )
}

function NavItem({ section, rail }: { section: NavSection; rail: boolean }): JSX.Element {
  const t = useT()
  const on = useStore((s) => s.view === section.id)
  const setView = useStore((s) => s.setView)
  /*
    Counts, not lists: the downloads array changes on every progress line, and
    the sidebar should redraw when a number it shows changes, not per tick.
  */
  const active = useStore((s) =>
    section.id === 'downloads' ? s.downloads.filter((d) => ACTIVE_STATES.includes(d.state)).length : 0
  )
  const overall = useStore((s) => (section.id === 'downloads' ? overallPercent(s.downloads) : null))
  const alerts = useStore((s) => (section.id === 'automation' ? s.watchAlerts : 0))
  const label = t(section.label)

  const badge =
    active > 0 ? (
      rail ? (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-pill bg-accent" aria-hidden="true" />
      ) : (
        <span
          className={cx(
            'mono ml-auto rounded-pill px-1.5 py-0.5 text-caption font-semibold leading-none',
            on ? 'bg-accent text-accent-fg' : 'bg-sink text-ink-2'
          )}
        >
          {overall != null ? `${overall}%` : active}
        </span>
      )
    ) : null

  const button = (
    <button
      type="button"
      onClick={() => setView(section.id)}
      aria-current={on ? 'page' : undefined}
      aria-label={rail ? label : undefined}
      className={cx(
        'ui-nav-item no-drag relative flex h-8 shrink-0 items-center gap-2.5 rounded-2 text-control font-medium',
        rail ? 'w-10 justify-center self-center' : 'w-full px-2.5',
        on ? 'ui-nav-item-on' : ''
      )}
    >
      <section.icon size={16} aria-hidden="true" className={on ? 'text-accent-ink' : 'text-ink-3'} />
      {!rail && <span className="min-w-0 truncate">{label}</span>}
      {badge}
      {alerts > 0 && (
        <span
          className={cx('h-1.5 w-1.5 rounded-pill bg-bad', rail ? 'absolute right-1.5 top-1.5' : 'ml-auto')}
          role="img"
          aria-label={t('auto.failingCount', { n: String(alerts) })}
        />
      )}
    </button>
  )
  return rail ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  )
}

const LANGUAGE_LABEL: Record<LanguageId, TranslationKey> = {
  auto: 'shell.language.auto',
  en: 'shell.language.en',
  ru: 'shell.language.ru'
}

function Footer({ rail }: { rail: boolean }): JSX.Element {
  const t = useT()
  const ytdlp = useStore((s) => s.ytdlp)
  const language = useStore((s) => s.settings?.language ?? 'auto')
  const save = useStore((s) => s.saveSettings)
  const openShortcuts = useStore((s) => s.setShortcutsOpen)
  const overall = useStore((s) => overallPercent(s.downloads))

  const tone = ytdlp.state === 'ready' ? 'bg-good' : ytdlp.state === 'error' ? 'bg-bad' : 'bg-warn'
  const busy = ytdlp.state === 'checking' || ytdlp.state === 'downloading'
  const engine =
    ytdlp.state === 'ready'
      ? t('engine.ready')
      : ytdlp.state === 'downloading'
        ? t('engine.downloading', { percent: ytdlp.percent ?? 0 })
        : ytdlp.state === 'checking'
          ? t('engine.checking')
          : ytdlp.state === 'error'
            ? t('engine.error')
            : t('engine.idle')

  const dot = <span className={cx('h-1.5 w-1.5 shrink-0 rounded-pill', tone, busy && 'animate-idle-pulse')} aria-hidden="true" />

  const actions = (
    <>
      <Menu
        label={t('shell.language')}
        align="start"
        items={(['auto', 'en', 'ru'] as LanguageId[]).map((id) => ({
          label: t(LANGUAGE_LABEL[id]),
          icon: id === language ? <Check size={14} /> : <span className="inline-block w-3.5" />,
          onSelect: () => void save({ language: id })
        }))}
        trigger={(p) => (
          <IconButton {...p} size="sm" label={t('shell.language')} icon={<Languages size={16} />} tooltipSide={rail ? 'right' : 'top'} />
        )}
      />
      <IconButton
        size="sm"
        label={t('browser.open')}
        icon={<Globe size={16} />}
        tooltipSide={rail ? 'right' : 'top'}
        onClick={() => void window.api.openBrowser()}
      />
      <IconButton
        size="sm"
        label={t('shortcuts.title')}
        icon={<Keyboard size={16} />}
        tooltipSide={rail ? 'right' : 'top'}
        onClick={() => openShortcuts(true)}
      />
    </>
  )

  if (rail) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 pb-3 pt-2">
        <Tooltip label={engine} side="right">
          <span className="flex h-7 w-7 items-center justify-center" tabIndex={0} role="img" aria-label={engine}>
            {dot}
          </span>
        </Tooltip>
        {actions}
      </div>
    )
  }

  return (
    <div className="shrink-0 space-y-2 px-3 pb-3 pt-2">
      <div className="mx-1 border-t border-edge-soft" />
      <div className="flex items-center gap-2 px-2.5 text-meta text-ink-2">
        {dot}
        <span className="min-w-0 truncate">{engine}</span>
      </div>
      {overall != null && (
        <div className="space-y-1 px-2.5" role="group" aria-label={t('shell.overall', { percent: overall })}>
          <div className="flex justify-between text-meta text-ink-2">
            <span>{t('shell.downloading')}</span>
            <span className="mono">{overall}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-pill bg-sink">
            <div className="h-full bg-accent" style={{ width: `${overall}%` }} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 px-1">{actions}</div>
    </div>
  )
}
