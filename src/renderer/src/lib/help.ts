import type { AppErrorCode } from '@shared/types'
import type { TranslateFn, TranslationKey } from '../i18n'
import type { ViewId } from '../store'
import { AlertTriangle, ChannelSecure, Download, FolderOpen, Globe, Info, Radar, Send, type IconComponent } from '../ui/icons'
import { fixFor } from './fixes'

/*
  Help, for someone who has never used a tool like this. Topics are data, so a
  test can walk them.

  A help string never spells out the name of a button or a section. It writes
  [[some.key]], and that key's text from the same dictionary is put in, in bold:
  help says exactly what the screen says, in both languages, and a renamed button
  renames itself here. A removed one fails help.test.ts rather than leaving a
  sentence telling someone to press something that is gone.
*/

export type HelpTopicId = 'download' | 'whereFile' | 'signIn' | 'newEpisodes' | 'browser' | 'cookies' | 'failed' | 'report'

export type HelpAction =
  | { kind: 'view'; view: ViewId; name: TranslationKey }
  /** `name` is what the page or row is called on screen. */
  | { kind: 'settings'; route: string; name: TranslationKey }
  | { kind: 'browser' }
  | { kind: 'downloadsFolder' }
  | { kind: 'addWatch' }
  | { kind: 'topic'; topic: HelpTopicId }

export interface HelpTopic {
  id: HelpTopicId
  icon: IconComponent
  title: TranslationKey
  summary: TranslationKey
  paragraphs?: TranslationKey[]
  /** What to do, in order: shown numbered. */
  steps?: TranslationKey[]
  note?: TranslationKey
  actions: HelpAction[]
}

const QUEUE: HelpAction = { kind: 'view', view: 'downloads', name: 'nav.queue' }

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'download',
    icon: Download,
    title: 'help.download.title',
    summary: 'help.download.summary',
    steps: ['help.download.step1', 'help.download.step2', 'help.download.step3'],
    actions: [{ kind: 'view', view: 'home', name: 'nav.home' }]
  },
  {
    id: 'whereFile',
    icon: FolderOpen,
    title: 'help.whereFile.title',
    summary: 'help.whereFile.summary',
    paragraphs: ['help.whereFile.where', 'help.whereFile.find', 'help.whereFile.library'],
    actions: [
      { kind: 'downloadsFolder' },
      { kind: 'view', view: 'library', name: 'nav.library' },
      { kind: 'settings', route: 'downloads#saveLocation', name: 'settings.saveLocation' }
    ]
  },
  {
    id: 'signIn',
    icon: ChannelSecure,
    title: 'help.signIn.title',
    summary: 'help.signIn.summary',
    steps: ['help.signIn.step1', 'help.signIn.step2', 'help.signIn.step3'],
    note: 'help.signIn.note',
    actions: [{ kind: 'browser' }, { kind: 'settings', route: 'access/import', name: 'prefs.sub.importSignIns' }]
  },
  {
    id: 'newEpisodes',
    icon: Radar,
    title: 'help.newEpisodes.title',
    summary: 'help.newEpisodes.summary',
    steps: ['help.newEpisodes.step1', 'help.newEpisodes.step2', 'help.newEpisodes.step3'],
    note: 'help.newEpisodes.note',
    actions: [{ kind: 'addWatch' }, { kind: 'view', view: 'automation', name: 'nav.automation' }]
  },
  {
    id: 'browser',
    icon: Globe,
    title: 'help.browser.title',
    summary: 'help.browser.summary',
    paragraphs: ['help.browser.what', 'help.browser.signIn', 'help.browser.pages'],
    actions: [{ kind: 'browser' }]
  },
  {
    id: 'cookies',
    icon: Info,
    title: 'help.cookies.title',
    summary: 'help.cookies.summary',
    paragraphs: ['help.cookies.what'],
    actions: [{ kind: 'settings', route: 'access#cookies', name: 'prefs.panel.access' }]
  },
  {
    id: 'failed',
    icon: AlertTriangle,
    title: 'help.failed.title',
    summary: 'help.failed.summary',
    steps: ['help.failed.step1', 'help.failed.step2', 'help.failed.step3', 'help.failed.step4'],
    actions: [QUEUE, { kind: 'browser' }, { kind: 'topic', topic: 'report' }]
  },
  {
    id: 'report',
    icon: Send,
    title: 'help.report.title',
    summary: 'help.report.summary',
    steps: ['help.report.step1', 'help.report.step2', 'help.report.step3'],
    note: 'help.report.note',
    actions: [
      QUEUE,
      { kind: 'settings', route: 'system/about', name: 'prefs.sub.about' },
      { kind: 'settings', route: 'access#errorReports', name: 'prefs.group.errorReports' }
    ]
  }
]

const REFERENCE = /\[\[([\w.]+)\]\]/g

/** The dictionary keys a help string names. */
export const helpReferences = (text: string): string[] => [...text.matchAll(REFERENCE)].map((m) => m[1])

export type HelpPart = string | { name: string }

/** A help string in pieces: its own words, and the names of things on screen. */
export function helpParts(text: string, t: TranslateFn): HelpPart[] {
  return text.split(REFERENCE).flatMap<HelpPart>((piece, i) => {
    if (i % 2) return [{ name: t(piece as TranslationKey) }]
    return piece ? [piece] : []
  })
}

/** The same as plain text, for a row's title and for search. */
export const helpPlain = (text: string, t: TranslateFn): string =>
  helpParts(text, t)
    .map((p) => (typeof p === 'string' ? p : p.name))
    .join('')

/** Every word of a topic: what its search looks through. */
export function helpSearchText(topic: HelpTopic, t: TranslateFn): string {
  const keys = [topic.title, topic.summary, ...(topic.paragraphs ?? []), ...(topic.steps ?? []), ...(topic.note ? [topic.note] : [])]
  return keys.map((key) => helpPlain(t(key), t)).join(' ')
}

/**
 * The topic that explains a failure, where the error and its button do not
 * already. "Change Folder" and "Retry in 5 Min" say what they do; "Sign In or
 * Use Cookies…" asks a question that has an answer here. A failure with no fix
 * of its own gets the general advice.
 */
export function helpForError(errorCode: AppErrorCode | undefined, cookieHint = false): HelpTopicId | null {
  switch (fixFor(errorCode, cookieHint)) {
    case 'cookies':
    case 'cookiesFile':
      return 'signIn'
    case 'browser':
      return 'browser'
    case 'proxy':
    case null:
      return 'failed'
    default:
      return null
  }
}
