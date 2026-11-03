import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { HeaderBar, IconButton, NavigationStack, cx, type StackPage } from '../../ui'
import { GoPrevious, Search } from '../../ui/icons'
import { SidebarToggle, WindowControls } from '../../shell/WindowControls'
import { useShellLayout } from '../../shell/layout'
import { PANELS, formatRoute, parentRoute, parseRoute, trail, type Route } from './router'
import { pageFor, type PanelProps } from './panels'
import { searchSettings } from './searchIndex'

/**
 * Settings, as GNOME Settings (gnome-control-center 46+, A1.1 §2, and the
 * user's own screenshot):
 *
 *  - ≥ 1100 px: three columns - the app sidebar, the panel list (on
 *    --sidebar-2, with an always-visible search under its header), and the
 *    panel page in the sheet;
 *  - 860-1099: the app sidebar folds to an overlay while Settings is open
 *    (its toggle is in the panel list's header), so the panel list is the
 *    only rail;
 *  - < 860: collapsed, as GNOME's is: the panel list is the first page; a
 *    panel pushes over it with a back button, subpages push again.
 *
 * The route (`<panel>[/<subpage>…][#row]`) lives in the store, so a deep link
 * from anywhere lands here; a `#row` is scrolled into view at once (no smooth
 * scroll: the frame clock may be stalled) and pulses for 1.2 s. Esc and
 * Alt+← go back.
 */
export default function SettingsView(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const save = useStore((s) => s.saveSettings)
  const routeText = useStore((s) => s.settingsRoute)
  const setRouteText = useStore((s) => s.setSettingsRoute)
  const setFolded = useStore((s) => s.setSidebarFolded)
  const deepLinked = useStore((s) => s.settingsDeepLinked)
  const { narrow, medium, pinned } = useShellLayout()
  const route = useMemo(() => parseRoute(routeText), [routeText])
  const [query, setQuery] = useState('')
  // Narrow mode opens on the list, unless something linked straight into a page.
  const [atList, setAtList] = useState(!deepLinked)
  useEffect(() => {
    if (deepLinked) {
      setAtList(false)
      useStore.setState({ settingsDeepLinked: false })
    }
  }, [deepLinked])

  // Never a double rail: fold the app sidebar at medium widths, restore it on the way out.
  useEffect(() => {
    setFolded(medium)
    return () => setFolded(false)
  }, [medium, setFolded])

  const go = useCallback(
    (r: Route) => {
      setRouteText(formatRoute(r))
      setAtList(false)
    },
    [setRouteText]
  )
  const back = useCallback(() => {
    if (route.sub.length) setRouteText(formatRoute(parentRoute(route)))
    else if (narrow) setAtList(true)
  }, [route, narrow, setRouteText])

  // Deep link to a row: instant scroll, then the pulse (CSS, no fill mode).
  const page = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!route.row) return
    const el = page.current?.querySelector<HTMLElement>(`[data-row="${route.row.replace(/[^\w-]/g, '')}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    el.classList.remove('ui-row-pulse')
    void el.offsetWidth
    el.classList.add('ui-row-pulse')
    const done = (): void => el.classList.remove('ui-row-pulse')
    el.addEventListener('animationend', done, { once: true })
  }, [route, atList])

  if (!settings) return <div />

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    void save({ [key]: value } as Partial<AppSettings>)
  }
  const props: PanelProps = { settings, set, go }

  const titles = trail(route).map((k) => t(k))
  const pages: StackPage[] = [
    { key: route.panel, node: pageFor({ panel: route.panel, sub: [] }, props) },
    ...route.sub.map((_, i) => {
      const r = { panel: route.panel, sub: route.sub.slice(0, i + 1) }
      return { key: formatRoute(r), node: pageFor(r, props) }
    })
  ]

  const list = (
    <PanelList
      route={route}
      query={query}
      onQuery={setQuery}
      onOpen={(r) => {
        setQuery('')
        go(r)
      }}
      wide={!narrow}
      showToggle={!pinned}
    />
  )

  if (narrow && atList) return list

  const showBack = route.sub.length > 0 || narrow
  const pane = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <HeaderBar
        data-uvd="settings-page-header"
        title={titles[titles.length - 1]}
        start={
          <>
            {/* Start-side caption buttons belong to the left-most bar: this one only when it is alone. */}
            {narrow && <WindowControls side="start" where="content" />}
            {narrow && !route.sub.length && <SidebarToggle />}
            {showBack && <IconButton label={t('prefs.back')} icon={<GoPrevious size={16} />} onClick={back} />}
          </>
        }
        end={<WindowControls side="end" where="content" />}
      />
      {/* Not a scroller: the top page in the stack is (NavigationStack). */}
      <div ref={page} className="flex min-h-0 flex-1 flex-col">
        <NavigationStack pages={pages} onBack={back} />
      </div>
    </div>
  )

  if (narrow) return pane
  return (
    <div className="flex h-full min-h-0">
      {list}
      {pane}
    </div>
  )
}

interface ListProps {
  route: Route
  query: string
  onQuery: (q: string) => void
  onOpen: (r: Route) => void
  /** A 260 px rail beside the page, or (narrow) the whole first page. */
  wide: boolean
  /** The app sidebar is an overlay: its toggle goes in this header. */
  showToggle: boolean
}

/** The panel list: "Settings" in its header, the search entry under it, rows in two groups. */
function PanelList({ route, query, onQuery, onOpen, wide, showToggle }: ListProps): JSX.Element {
  const t = useT()
  const hits = searchSettings(query, t)
  const searching = query.trim().length > 0
  const row = (r: Route, label: string, icon: JSX.Element | null, on: boolean, sub?: string, key?: string): JSX.Element => (
    <button
      key={key ?? label}
      type="button"
      onClick={() => onOpen(r)}
      aria-current={on ? 'page' : undefined}
      className={cx('ui-nav-item no-drag flex min-h-[44px] w-full items-center gap-3 rounded-1 px-3 py-1.5 text-left text-body', on && 'ui-nav-item-on')}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-meta text-ink-2">{sub}</span>}
      </span>
    </button>
  )
  return (
    <div
      className={cx('flex min-h-0 flex-col bg-sidebar-2', wide ? 'w-[260px] shrink-0 border-r border-edge' : 'h-full flex-1')}
      data-uvd="settings-list"
    >
      <HeaderBar
        data-uvd="settings-list-header"
        title={t('settings.title')}
        start={
          <>
            {showToggle && <WindowControls side="start" where="content" />}
            {showToggle && <SidebarToggle />}
          </>
        }
        end={!wide ? <WindowControls side="end" where="content" /> : undefined}
      />
      <div className={cx('min-h-0 flex-1 overflow-y-auto px-2 pb-3', !wide && 'mx-auto w-full max-w-[600px]')}>
        <label className="field mb-2 flex cursor-text items-center gap-2">
          <Search size={16} className="shrink-0 text-ink-2" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc empties the search before anything else answers it.
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                onQuery('')
              }
            }}
            placeholder={t('settings.search')}
            aria-label={t('settings.search')}
            className="no-drag min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
            spellCheck={false}
          />
        </label>
        <nav aria-label={t('settings.title')} className="flex flex-col gap-0.5">
          {searching ? (
            hits.length ? (
              hits.map((h) => row(parseRoute(h.entry.route), t(h.entry.title), null, false, h.where, h.entry.route))
            ) : (
              <p className="px-3 py-6 text-center text-body text-ink-2">{t('settings.searchEmpty')}</p>
            )
          ) : (
            PANELS.map((p, i) => (
              <div key={p.id}>
                {i > 0 && PANELS[i - 1].group !== p.group && <div className="mx-3 my-1.5 h-px bg-fill/15" role="separator" />}
                {row({ panel: p.id, sub: [] }, t(p.title), <p.icon size={16} />, wide && route.panel === p.id)}
              </div>
            ))
          )}
        </nav>
      </div>
    </div>
  )
}
