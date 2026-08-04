/**
 * English strings — the source of truth. Every other locale is typed against
 * this object, so a missing translation is a compile error rather than a
 * mystery blank label at runtime.
 */
export const en = {
  // ---- common ----
  'common.cancel': 'cancel',
  'common.close': 'close',
  'common.retry': 'retry',
  'common.remove': 'remove',
  'common.pause': 'pause',
  'common.resume': 'resume',
  'common.play': 'play',
  'common.open': 'open',
  'common.openInBrowser': 'open in browser',
  'common.showInFolder': 'show in folder',
  'common.copy': 'copy',
  'common.copied': 'copied',
  'common.all': 'all',
  'common.clear': 'clear',
  'common.download': 'download',
  'common.search': 'search',
  'common.best': 'best',
  'common.video': 'video',
  'common.audioOnly': 'audio only',
  'common.quality': 'quality',
  'common.format': 'format',
  'common.change': 'change',
  'common.check': 'check',
  'common.update': 'update',
  'common.off': 'off',
  'common.details': 'details',
  'common.paste': 'paste from clipboard',

  // ---- navigation ----
  'nav.home': 'download',
  'nav.queue': 'queue',
  'nav.search': 'search',
  'nav.settings': 'settings',
  'nav.github': 'open source · github',

  // ---- title bar ----
  'engine.ready': 'engine ready',
  'engine.downloading': 'engine {percent}%',
  'engine.checking': 'engine…',
  'engine.error': 'engine error',
  'engine.idle': 'engine',

  // ---- home ----
  'home.title': 'paste a link, get the video',
  'home.subtitle': 'automatic stream detection for thousands of sites — or type a title to search.',
  'home.placeholder': 'paste a video link — or search by title',
  'home.get': 'get',
  'home.errorTitle': 'couldn’t detect a video',
  'home.openAccessSettings': 'open settings → access',
  'home.moreSites': '+1800 more',
  'home.batch': 'multiple links',
  'home.batchHint': 'one link per line — each becomes its own download',
  'home.batchAdd': 'queue {count} links',
  'home.batchOpen': 'paste several links at once',
  'home.universal': 'found by universal detection',
  'home.universalHint':
    'the engine didn’t know this site, so the app opened the page and captured the stream itself.',
  'home.clipboardFound': 'link on your clipboard',
  'home.clipboardUse': 'use it',
  'home.dropHere': 'drop the link anywhere',
  'home.addedToQueue': 'added to the queue',
  'home.startFailed': 'could not start the download',

  // ---- detection stages ----
  'detect.resolving': 'checking the link…',
  'detect.engine': 'asking the engine…',
  'detect.scraping': 'reading the page…',
  'detect.browsing': 'opening the page to find the stream…',
  'detect.probing': 'reading stream details…',
  'detect.slowHint': 'unknown site — this can take up to half a minute.',

  // ---- queue ----
  'queue.title': 'queue',
  'queue.items': '{count} items',
  'queue.item': '{count} item',
  'queue.empty': 'nothing here yet',
  'queue.emptyHint': 'paste a link to get started',
  'queue.emptyFiltered': 'nothing matches this filter',
  'queue.add': 'add a download',
  'queue.openFolder': 'open folder',
  'queue.clearFinished': 'clear finished',
  'queue.pauseAll': 'pause all',
  'queue.resumeAll': 'resume all',
  'queue.retryFailed': 'retry failed',
  'queue.filterAll': 'all',
  'queue.filterActive': 'active',
  'queue.filterDone': 'done',
  'queue.filterFailed': 'failed',
  'queue.searchPlaceholder': 'filter by title…',
  'queue.log': 'engine output',
  'queue.copyError': 'copy the error',
  'queue.retryingIn': 'retrying automatically…',

  // ---- download states ----
  'state.queued': 'queued',
  'state.detecting': 'preparing',
  'state.downloading': 'downloading',
  'state.processing': 'processing',
  'state.completed': 'completed',
  'state.error': 'failed',
  'state.paused': 'paused',
  'state.canceled': 'canceled',

  // ---- playlist ----
  'playlist.videos': '{count} videos',
  'playlist.downloadAll': 'download all ({count})',
  'playlist.downloadOne': 'download this one',
  'playlist.selected': 'download selected ({count})',
  'playlist.selectAll': 'select all',
  'playlist.added': 'added {count} videos to the queue',

  // ---- streaming picker ----
  'streaming.voiceover': 'voiceover · озвучка',
  'streaming.season': 'season · сезон',
  'streaming.episodes': 'episodes · серии',
  'streaming.quality': 'quality · качество',
  'streaming.premium': 'premium',
  'streaming.premiumHint': 'requires Premium — cannot be downloaded',
  'streaming.series': 'series',
  'streaming.seriesSeasons': 'series · {count} seasons',
  'streaming.movie': 'movie',
  'streaming.selectEpisode': 'select at least one episode',
  'streaming.addedEpisodes': 'added {count} episodes to the queue',

  // ---- format selector ----
  'format.exactStream': 'choose exact stream ({count})',
  'format.audioFormat': 'audio format',
  'format.plusAudio': '+ audio',
  'format.upTo': 'up to {height}p',
  'format.subtitles': '{count} subtitle tracks',

  // ---- search ----
  'search.title': 'search across every service',
  'search.hint': 'videos, music & anime — type a title and press enter',
  'search.placeholder': 'search videos, music & anime by title',
  'search.services': 'services',
  'search.allServices': 'all services',
  'search.searching': 'searching {service}',
  'search.results': '{count} results',
  'search.nothing': 'nothing found',
  'search.nothingHint': 'try different keywords',
  'search.failed': 'search failed',
  'search.episodes': 'episodes',
  'search.queued': 'queued',
  'search.addedRemote': 'added to the queue — see the main window',
  'search.qualityProbe': 'quality…',
  'search.anime': 'anime',
  'search.audio': 'audio',

  // ---- settings ----
  'settings.title': 'settings',
  'settings.section.appearance': 'appearance',
  'settings.section.downloads': 'downloads',
  'settings.section.processing': 'post-processing',
  'settings.section.detection': 'detection',
  'settings.section.access': 'access & cookies',
  'settings.section.network': 'network',
  'settings.section.system': 'system',
  'settings.section.updates': 'updates',
  'settings.section.about': 'about',

  'settings.language': 'language',
  'settings.language.auto': 'system',
  'settings.theme': 'theme',
  'settings.theme.midnight': 'midnight',
  'settings.theme.carbon': 'carbon',
  'settings.theme.nebula': 'nebula',
  'settings.theme.daylight': 'daylight',
  'settings.accent': 'accent',

  'settings.saveLocation': 'save location',
  'settings.subfolders': 'sort into subfolders',
  'settings.subfoldersHint': 'a folder per site, inside the save location',
  'settings.defaultMode': 'default mode',
  'settings.defaultQuality': 'default quality',
  'settings.defaultQualityHint':
    'best = automatically picks the highest quality the video offers. a fixed choice falls back to best when it isn’t available.',
  'settings.audioFormat': 'audio format',
  'settings.audioFormatHint': 'used for audio-only downloads',
  'settings.concurrent': 'simultaneous downloads',
  'settings.speedLimit': 'speed limit',
  'settings.speedLimitHint': 'e.g. 2M or 500K — leave empty for unlimited',

  'settings.embedThumbnail': 'embed thumbnail',
  'settings.embedThumbnailHint': 'adds cover art to the file',
  'settings.embedMetadata': 'embed metadata',
  'settings.embedMetadataHint': 'title, author, description',
  'settings.embedChapters': 'embed chapters',
  'settings.embedChaptersHint': 'jump marks inside the video file',
  'settings.embedSubtitles': 'embed subtitles',
  'settings.embedSubtitlesHint': 'burn the subtitle tracks into the file',
  'settings.writeSubtitles': 'save subtitles as files',
  'settings.writeSubtitlesHint': 'separate .srt files next to the video',
  'settings.subtitleLanguages': 'subtitle languages',
  'settings.subtitleLanguagesHint': 'comma-separated codes, or "all"',
  'settings.sponsorBlock': 'skip sponsor segments',
  'settings.sponsorBlockHint': 'removes sponsor, self-promo and interaction segments (YouTube)',
  'settings.restrictFilenames': 'restrict filenames',
  'settings.restrictFilenamesHint': 'ascii-only, no spaces',
  'settings.filenameTemplate': 'filename template',
  'settings.filenameTemplateHint': 'yt-dlp output template',

  'settings.universal': 'universal detection',
  'settings.universalHint':
    'when the engine doesn’t know a site, open the page in a hidden browser window and capture the video stream from it. this is what makes unsupported sites work — turn it off if you prefer the app to never load remote pages.',

  'settings.cookies': 'use cookies from browser',
  'settings.cookiesHint':
    'many sites (including adult sites) gate videos behind an age or login check — point the app at a browser where you’re signed in to get past it. close that browser while downloading.',
  'settings.cookiesFile': 'cookies.txt file',
  'settings.cookiesFileHint': 'takes precedence over the browser above',
  'settings.cookiesFileChoose': 'choose file',
  'settings.cookiesFileClear': 'clear',

  'settings.proxy': 'proxy',
  'settings.proxyPlaceholder': 'http://host:port (optional)',

  'settings.notifications': 'desktop notifications',
  'settings.notificationsHint': 'tell me when a download finishes',
  'settings.clipboardWatch': 'watch the clipboard',
  'settings.clipboardWatchHint': 'offer to download links you copy in other apps',
  'settings.tray': 'keep running in the tray',
  'settings.trayHint': 'closing the window keeps downloads going',

  'settings.autoUpdate': 'automatic app updates',
  'settings.autoUpdateHint': 'check on launch and notify',
  'settings.appVersion': 'app version',
  'settings.updateAvailable': 'update {version} available',
  'settings.upToDate': 'you are up to date',
  'settings.engine': 'download engine',
  'settings.manualUpdates': 'this build installs updates manually',
  'settings.manualUpdatesHint': 'we’ll open the downloads page for you',

  'settings.about':
    'powered by the open-source yt-dlp engine and ffmpeg. please respect the terms of service and copyright of the sites you download from.',
  'settings.viewOnGithub': 'view on github',
  'settings.reset': 'reset all settings',
  'settings.resetDone': 'settings restored to defaults',

  // ---- update banner ----
  'update.available': 'version {version} is available',
  'update.availableHint': 'ready to download and install',
  'update.availableManualHint': 'opens the download page in your browser',
  'update.downloading': 'downloading update…',
  'update.ready': 'update {version} ready',
  'update.readyHint': 'the app will restart to apply it',
  'update.action': 'update',
  'update.restart': 'restart',
  'update.getIt': 'get it',

  // ---- mac notice ----
  'mac.title': 'macOS says the app is “damaged” or won’t open?',

  // ---- shortcuts ----
  'shortcuts.title': 'keyboard shortcuts',
  'shortcuts.open': 'shortcuts',
  'shortcuts.newDownload': 'new download',
  'shortcuts.queue': 'open the queue',
  'shortcuts.search': 'search by title',
  'shortcuts.settings': 'settings',
  'shortcuts.paste': 'paste a link and detect',
  'shortcuts.help': 'this list',
  'shortcuts.escape': 'clear / close',

  // ---- errors ----
  'error.title': 'something went wrong',
  'error.reload': 'reload the app',
  'error.starting': 'starting up…'
} as const

export type TranslationKey = keyof typeof en
export type Dictionary = Record<TranslationKey, string>
