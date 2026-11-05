import type { TranslationKey } from '../../i18n'
import { matchesQuery } from '../../lib/settingsSearch'
import { parseRoute, trail } from './router'

/**
 * Every searchable row, by route (D8: settingsSearch now indexes
 * panel › subpage › row). The same matching rules as before
 * (lib/settingsSearch): every word of the query, in any order, in the row's
 * title, hint, or the names of the pages it sits in. Each `route` is a deep
 * link, and its `#row` is the id the row carries on screen
 * (settings.test.tsx checks that each one is there).
 */
export interface IndexEntry {
  route: string
  title: TranslationKey
  hint?: TranslationKey
}

export const SEARCH_INDEX: IndexEntry[] = [
  { route: 'appearance#style', title: 'prefs.group.style', hint: 'settings.theme' },
  { route: 'appearance#accent', title: 'prefs.group.accent' },
  { route: 'appearance#language', title: 'settings.language' },
  { route: 'downloads#saveLocation', title: 'settings.saveLocation' },
  { route: 'downloads#subfolders', title: 'settings.subfolders', hint: 'settings.subfoldersHint' },
  { route: 'downloads#defaultMode', title: 'settings.defaultMode' },
  { route: 'downloads#quality', title: 'settings.defaultQuality', hint: 'settings.defaultQualityHint' },
  { route: 'downloads#audioFormat', title: 'settings.audioFormat', hint: 'settings.audioFormatHint' },
  { route: 'downloads#concurrent', title: 'settings.concurrent' },
  { route: 'downloads#resume', title: 'settings.resumeOnLaunch', hint: 'settings.resumeOnLaunchHint' },
  { route: 'downloads#keepFinished', title: 'settings.keepFinished', hint: 'settings.keepFinishedHint' },
  { route: 'downloads#speedLimit', title: 'settings.speedLimit', hint: 'settings.speedLimitHint' },
  { route: 'downloads#playlistLimit', title: 'settings.playlistLimit', hint: 'settings.playlistLimitHint' },
  { route: 'processing#thumbnail', title: 'settings.embedThumbnail', hint: 'settings.embedThumbnailHint' },
  { route: 'processing#metadata', title: 'settings.embedMetadata', hint: 'settings.embedMetadataHint' },
  { route: 'processing#chapters', title: 'settings.embedChapters', hint: 'settings.embedChaptersHint' },
  { route: 'processing#embedSubtitles', title: 'settings.embedSubtitles', hint: 'settings.embedSubtitlesHint' },
  { route: 'processing#writeSubtitles', title: 'settings.writeSubtitles', hint: 'settings.writeSubtitlesHint' },
  { route: 'processing#subtitleLanguages', title: 'settings.subtitleLanguages', hint: 'settings.subtitleLanguagesHint' },
  { route: 'processing#sponsorBlock', title: 'settings.sponsorBlock', hint: 'settings.sponsorBlockHint' },
  { route: 'processing#compatible', title: 'settings.preferCompatible', hint: 'settings.preferCompatibleHint' },
  { route: 'processing#restrict', title: 'settings.restrictFilenames', hint: 'settings.restrictFilenamesHint' },
  { route: 'processing#template', title: 'settings.filenameTemplate', hint: 'settings.filenameTemplateHint' },
  { route: 'watching#background', title: 'settings.background', hint: 'settings.backgroundHint' },
  { route: 'watching/shares', title: 'settings.shares', hint: 'settings.sharesHint' },
  { route: 'watching/telegram', title: 'settings.telegram', hint: 'settings.telegramHint' },
  { route: 'detection#universal', title: 'settings.universal', hint: 'settings.universalHint' },
  { route: 'detection#adult', title: 'settings.adultServices', hint: 'settings.adultServicesHint' },
  { route: 'access#cookies', title: 'settings.cookies', hint: 'settings.cookiesHint' },
  { route: 'access/cookies-file', title: 'settings.cookiesFile', hint: 'settings.cookiesFileHint' },
  { route: 'access/passwords', title: 'prefs.sub.passwords', hint: 'prefs.row.browserPasswordsHint' },
  { route: 'access/import', title: 'prefs.sub.importSignIns', hint: 'prefs.row.importSignInsHint' },
  { route: 'access', title: 'prefs.row.browserSignedIn', hint: 'prefs.row.browserSignedInHint' },
  { route: 'access#errorReports', title: 'settings.errorReports', hint: 'settings.errorReportsHint' },
  { route: 'network/proxy#address', title: 'settings.proxy' },
  { route: 'network/proxy#password', title: 'settings.proxyPassword', hint: 'settings.proxyPasswordHint' },
  { route: 'system/startup#autostart', title: 'settings.autostart', hint: 'settings.autostartHint' },
  { route: 'system/startup#notifications', title: 'settings.notifications', hint: 'settings.notificationsHint' },
  { route: 'system/startup#clipboard', title: 'settings.clipboardWatch', hint: 'settings.clipboardWatchHint' },
  { route: 'system/startup#tray', title: 'settings.tray', hint: 'settings.trayHint' },
  { route: 'system/updates#autoUpdate', title: 'settings.autoUpdate', hint: 'settings.autoUpdateHint' },
  { route: 'system/updates#check', title: 'settings.appVersion' },
  { route: 'system/updates#engine', title: 'settings.engine' },
  { route: 'system/backup#export', title: 'settings.backupExport', hint: 'settings.backupExportHint' },
  { route: 'system/backup#import', title: 'settings.backupImport', hint: 'settings.backupImportHint' },
  { route: 'system/logs#verbose', title: 'settings.logVerbose', hint: 'settings.logVerboseHint' },
  { route: 'system/logs#log', title: 'settings.logRow' },
  { route: 'system/logs#cli', title: 'settings.cli' },
  { route: 'system/about', title: 'prefs.sub.about', hint: 'settings.about' },
  { route: 'system/about/legal', title: 'prefs.sub.legal' },
  { route: 'system#reset', title: 'settings.reset' }
]

export interface SearchHit {
  entry: IndexEntry
  /** "Panel › Subpage", in the language on screen. */
  where: string
}

/** The rows a query finds, in index order. `t` is the translator for the language on screen. */
export function searchSettings(query: string, t: (k: TranslationKey) => string): SearchHit[] {
  if (!query.trim()) return []
  return SEARCH_INDEX.flatMap((entry) => {
    const route = parseRoute(entry.route)
    const pages = trail(route).map((k) => t(k))
    const where = pages.join(' › ')
    return matchesQuery(query, t(entry.title), entry.hint && t(entry.hint), ...pages) ? [{ entry, where }] : []
  })
}
