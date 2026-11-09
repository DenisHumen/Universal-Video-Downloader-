import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../../../test/axe'
import App from '../App'
import { en } from '../i18n/en'
import { ru } from '../i18n/ru'
import { useI18n, type TranslationKey } from '../i18n'
import { helpForError, helpPlain, helpReferences, HELP_TOPICS } from '../lib/help'
import { installMockApi } from '../lib/mockApi'
import { BOOKMARKLET } from '@shared/sent-link'
import { NAV_ALL } from '../shell/nav'
import { useStore } from '../store'
import { formatRoute, parseRoute, PANELS, SUBPAGES } from './settings/router'
import { SEARCH_INDEX } from './settings/searchIndex'

const HELP_KEYS = (Object.keys(en) as TranslationKey[]).filter((k) => k.startsWith('help.') || k === 'setup.helpWhere')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'i18n' ? [] : sources(path)
    return /[.]tsx?$/.test(entry) && !/[.]test[.]/.test(entry) && entry !== 'help.ts' ? [path] : []
  })
}

describe('what help names', () => {
  const screens = sources('src')
    .map((f) => readFileSync(f, 'utf-8'))
    .join('\n')

  it.each([
    ['en', en],
    ['ru', ru]
  ] as const)('%s: every name is a real string that something on screen uses', (_lang, dict) => {
    for (const key of HELP_KEYS) {
      for (const ref of helpReferences(dict[key])) {
        expect(dict[ref as TranslationKey], `${key} names ${ref}, which is gone`).toBeTruthy()
        // The text alone proves nothing: a dropped button can leave its string behind.
        expect(screens.includes(`'${ref}'`), `${key} names ${ref}, which nothing shows`).toBe(true)
      }
    }
  })

  it('names the same things in both languages', () => {
    const sorted = (s: string): string[] => helpReferences(s).sort()
    for (const key of HELP_KEYS) expect(sorted(ru[key]), key).toEqual(sorted(en[key]))
  })

  /*
    The point of [[key]]: a name typed out by hand is what goes stale. Only the
    quotes around a reference are allowed, for a title, where bold is not an option.
  */
  it.each([
    ['en', en],
    ['ru', ru]
  ] as const)('%s: types no name out by hand', (_lang, dict) => {
    for (const key of HELP_KEYS) {
      const own = dict[key].replace(/«?\[\[[\w.]+\]\]»?/g, '').replace(/\{name\}/, '')
      if (key === 'help.goTo') continue
      expect(/[«»“”"]/.test(own), `${key}: ${dict[key]}`).toBe(false)
    }
  })

  it('uses today’s words, in plain language', () => {
    const stale = /Activity|Watching|Активност|Слежени|движ[оке]|поток|постобработк/i
    for (const key of HELP_KEYS) {
      expect(stale.test(helpPlain(en[key], (k) => en[k])), key).toBe(false)
      expect(stale.test(helpPlain(ru[key], (k) => ru[k])), key).toBe(false)
    }
  })
})

describe('where help sends you', () => {
  const actions = HELP_TOPICS.flatMap((h) => h.actions.map((a) => [h.id, a] as const))

  it('has the nine topics, each with a way to go there', () => {
    expect(HELP_TOPICS.map((h) => h.id)).toEqual(['download', 'whereFile', 'signIn', 'newEpisodes', 'browser', 'cookies', 'send', 'failed', 'report'])
    for (const h of HELP_TOPICS) expect(h.actions.length, h.id).toBeGreaterThan(0)
  })

  it('only into sections that exist, under their own names', () => {
    for (const [id, a] of actions) {
      if (a.kind !== 'view') continue
      const section = NAV_ALL.find((s) => s.id === a.view)
      expect(section, `${id} → ${a.view}`).toBeTruthy()
      expect(a.name, id).toBe(section!.label)
    }
  })

  it('only into settings that exist', () => {
    const known = new Set([...SEARCH_INDEX.map((e) => e.route), ...PANELS.map((p) => p.id), ...Object.keys(SUBPAGES)])
    for (const [id, a] of actions) {
      if (a.kind !== 'settings') continue
      expect(known.has(a.route), `${id} → ${a.route}`).toBe(true)
      // parseRoute falls back to the nearest page: a gone route would open somewhere else, silently.
      expect(formatRoute(parseRoute(a.route)), `${id} → ${a.route}`).toBe(a.route)
    }
  })

  it('only to topics that exist', () => {
    const ids = HELP_TOPICS.map((h) => h.id)
    for (const [, a] of actions) if (a.kind === 'topic') expect(ids).toContain(a.topic)
  })
})

describe('which failures link to help', () => {
  it('explains the fixes that need it and leaves alone the ones that say what they do', () => {
    expect(helpForError('signIn')).toBe('signIn')
    expect(helpForError('forbidden')).toBe('browser')
    expect(helpForError('geo')).toBe('failed')
    expect(helpForError(undefined)).toBe('failed')
    expect(helpForError(undefined, true)).toBe('signIn')
    for (const code of ['diskFull', 'rateLimited', 'noSuchFormat', 'upcoming'] as const) expect(helpForError(code), code).toBeNull()
  })
})

describe('the Help page', () => {
  beforeAll(() => installMockApi())
  beforeEach(() => {
    useI18n.getState().setLanguage('en')
    useStore.setState({ view: 'home', paletteOpen: false, helpTopic: null })
  })

  async function app(): Promise<void> {
    render(<App />)
    await waitFor(() => expect(useStore.getState().ready).toBe(true))
    await window.api.setSettings({ setupDone: true })
    act(() => useStore.getState().setSetupOpen(false))
  }

  it('opens from the primary menu, with its title in the header, and passes axe', async () => {
    await app()
    // jsdom's window is narrow, where the sidebar is an overlay.
    act(() => useStore.getState().setSidebarOverlayOpen(true))
    fireEvent.click(screen.getByRole('button', { name: 'Main Menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Help' }))
    expect(useStore.getState().view).toBe('guide')
    expect(screen.getByRole('heading', { name: 'Help' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'How to Download a Video' })).toBeTruthy()
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('is one of the things the palette finds, by what an answer says as well as by its title', async () => {
    await app()
    act(() => useStore.getState().setPaletteOpen(true))
    const box = await screen.findByRole('combobox')
    expect(screen.getByRole('option', { name: 'Help' })).toBeTruthy()
    // Topics wait until something is typed.
    expect(screen.queryByRole('option', { name: 'What Are Cookies?' })).toBeNull()
    fireEvent.change(box, { target: { value: 'small notes' } })
    fireEvent.click(screen.getByRole('option', { name: 'What Are Cookies?' }))
    expect(useStore.getState().view).toBe('guide')
    expect(useStore.getState().helpTopic).toBe('cookies')
    expect(screen.getByText(/Cookies are small notes/)).toBeTruthy()
  })

  it('opens the topic it was asked for, and folds it open again when asked again', async () => {
    await app()
    act(() => useStore.getState().openHelp('signIn'))
    const row = screen.getByRole('button', { name: 'A Site Asks Me to Sign In' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(row)
    expect(screen.getByRole('button', { name: 'A Site Asks Me to Sign In' }).getAttribute('aria-expanded')).toBe('false')
    act(() => useStore.getState().openHelp('signIn'))
    expect(screen.getByRole('button', { name: 'A Site Asks Me to Sign In' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('names buttons in bold, with the words the screen uses, in either language', async () => {
    await app()
    act(() => useStore.getState().openHelp('download'))
    expect(screen.getByText(en['home.get']).tagName).toBe('B')
    act(() => useI18n.getState().setLanguage('ru'))
    expect(screen.getByText(ru['home.get']).tagName).toBe('B')
    expect(screen.getByRole('button', { name: 'Открыть «Скачать»' })).toBeTruthy()
  })

  it('takes you there: a section, a setting, the browser, the folder, the add dialog', async () => {
    await app()
    const open = async (topic: Parameters<ReturnType<typeof useStore.getState>['openHelp']>[0], name: string): Promise<void> => {
      act(() => useStore.getState().openHelp(topic))
      fireEvent.click(screen.getByRole('button', { name }))
    }
    await open('download', 'Go to Download')
    expect(useStore.getState().view).toBe('home')

    await open('cookies', 'Go to Access & Cookies')
    expect(useStore.getState().view).toBe('settings')
    expect(useStore.getState().settingsRoute).toBe('access#cookies')

    const browser = vi.spyOn(window.api, 'openBrowser')
    await open('browser', 'Open the Built-in Browser')
    expect(browser).toHaveBeenCalled()

    const folder = vi.spyOn(window.api, 'openPath')
    await open('whereFile', 'Open the Downloads Folder')
    expect(folder).toHaveBeenCalledWith(useStore.getState().settings!.downloadDir)

    act(() => useStore.getState().openHelp('failed'))
    const [button] = within(document.getElementById('help-failed')!).getAllByRole('button', { name: 'How to Send a Report' })
    fireEvent.click(button)
    expect(useStore.getState().helpTopic).toBe('report')
  })

  it('explains sending from a browser, with buttons that do what they say, in either language', async () => {
    await app()
    act(() => useStore.getState().openHelp('send'))
    const external = vi.spyOn(window.api, 'openExternal').mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'How to Add the Extension' }))
    expect(external).toHaveBeenCalledWith(expect.stringContaining('/browser-extension'))

    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Copy Bookmark Address' }))
    expect(writeText).toHaveBeenCalledWith(BOOKMARKLET)
    expect(await screen.findByText('Copied')).toBeTruthy()

    act(() => useI18n.getState().setLanguage('ru'))
    expect(screen.getByRole('button', { name: 'Отправка из браузера' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Скопировать адрес закладки' })).toBeTruthy()
  })

  it('searches its own answers, opened, and says so when there is nothing', async () => {
    await app()
    act(() => useStore.getState().openHelp())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Help' }), { target: { value: 'voiceover' } })
    expect(screen.queryByRole('button', { name: 'What Are Cookies?' })).toBeNull()
    const row = screen.getByRole('button', { name: 'What New Episodes and Videos Does' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Help' }), { target: { value: 'zzzz' } })
    expect(screen.getByText('Nothing in Help matches')).toBeTruthy()
  })

  it('is what the link on a failed row opens, and only where it helps', async () => {
    await app()
    act(() => useStore.getState().setView('downloads'))
    act(() => window.__uvdMock!.queue({ id: 'help-1', title: 'Needs sign-in', state: 'error', errorCode: 'signIn' }))
    act(() => window.__uvdMock!.queue({ id: 'help-2', title: 'Disk full', state: 'error', errorCode: 'diskFull' }))
    await screen.findByText('Needs sign-in')
    expect(screen.getAllByRole('button', { name: 'How Do I Fix This?' })).toHaveLength(1)
    const row = screen.getByText('Needs sign-in').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'How Do I Fix This?' }))
    expect(useStore.getState().view).toBe('guide')
    expect(useStore.getState().helpTopic).toBe('signIn')
  })

  it('is where the last step of the first-run dialog says it lives', async () => {
    await app()
    act(() => useStore.getState().setSetupOpen(true))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(screen.getByRole('dialog')).getByText('Help').tagName).toBe('B')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }))
  })
})
