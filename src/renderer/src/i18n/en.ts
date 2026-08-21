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
  'common.paste': 'paste from clipboard',

  // ---- navigation ----
  'nav.home': 'download',
  'nav.queue': 'queue',
  'nav.search': 'search',
  'nav.settings': 'settings',

  // ---- title bar ----
  'engine.ready': 'engine ready',
  'engine.downloading': 'engine {percent}%',
  'engine.checking': 'engine…',
  'engine.error': 'engine error',
  'engine.idle': 'engine',
  'engine.setupLabel': 'setup',
  'engine.setupTitle': 'getting the download engine ready',
  'engine.setupOnce': 'one time, about 30 MB',
  'engine.setupFailed': 'the download engine could not be installed',

  // ---- home ----
  'home.title': 'paste a link, get the video',
  'home.subtitle': 'automatic stream detection for thousands of sites — or type a title to search.',
  'home.placeholder': 'paste a video link — or search by title',
  'home.linkLabel': 'video link',
  'home.saveDefault': 'use default folder',
  'home.get': 'get video',
  'home.errorTitle': 'couldn’t detect a video',
  'home.openAccessSettings': 'open settings → access',
  'home.batch': 'multiple links',
  'home.batchHint': 'one link per line — each becomes its own download',
  'home.batchAdd': 'queue {count} links',
  'home.batchOpen': 'paste several links at once',
  'home.universal': 'found by universal detection',
  'home.universalHint':
    'the engine didn’t know this site, so the app opened the page and captured the stream itself.',
  'home.clipboardFound': 'link on your clipboard',
  'home.clipboardUse': 'use it',
  'home.addedToQueue': 'added to the queue',
  'home.startFailed': 'could not start the download',
  'home.liveHint':
    'this is a live stream — it records from now until you stop it, so there is no length to trim and no percentage to report.',

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
  'queue.emptyFilteredHint': 'try another filter, or clear the search box',
  'queue.clearFilters': 'show everything',
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
  'queue.remaining': '{size} left',
  'queue.eta': '{time} left',
  'queue.etaAll': '≈ {time} left in total',
  'queue.duplicate': 'already in the queue',
  'queue.addedWithDuplicates': 'added {count} · {duplicates} already queued',
  'queue.copyLink': 'copy the link',
  'queue.openSource': 'open the source page',
  'queue.moveUp': 'download this one next',
  'queue.next': 'next up',
  'queue.log': 'engine output',
  'queue.copyError': 'copy the error',
  'queue.retryingIn': 'retrying automatically…',

  // ---- download states ----
  'state.queued': 'queued',
  'state.detecting': 'preparing',
  'state.downloading': 'downloading',
  'state.processing': 'processing',
  'phase.trim': 'trimming',
  'phase.merge': 'merging',
  'phase.convert': 'converting',
  'state.completed': 'completed',
  'state.error': 'failed',
  'state.paused': 'paused',
  'state.canceled': 'canceled',

  // ---- playlist ----
  'playlist.videos': '{count} videos',
  'playlist.downloadAll': 'download all ({count})',
  'playlist.selected': 'download selected ({count})',
  'playlist.selectAll': 'select all',
  'playlist.range': 'items',
  'playlist.selectRange': 'select range',
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

  // ---- format selector ----
  'format.exactStream': 'choose exact stream ({count})',
  'format.audioFormat': 'audio format',
  'format.plusAudio': '+ audio',
  'format.upTo': 'up to {height}p',
  'format.subtitles': '{count} subtitle tracks',
  'format.youGet': 'you get',

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
  'settings.theme.night': 'night',
  'settings.theme.day': 'day',

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
  'settings.resumeOnLaunch': 'resume interrupted downloads',
  'settings.resumeOnLaunchHint':
    'when the app is closed mid-download, pick it back up on the next launch. downloads you paused yourself stay paused.',
  'settings.speedLimit': 'speed limit',
  'settings.speedLimitHint': 'e.g. 2M or 500K — leave empty for unlimited',
  'settings.playlistLimit': 'channel & playlist depth',
  'settings.playlistLimitHint':
    'how many videos to list when you paste a channel or playlist link',

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
  'mac.why':
    'It isn’t — the build is unsigned, so Gatekeeper quarantines it. Run this once in Terminal:',

  // ---- shortcuts ----
  'shortcuts.title': 'keyboard shortcuts',
  'shortcuts.newDownload': 'new download',
  'shortcuts.queue': 'open the queue',
  'shortcuts.search': 'search by title',
  'shortcuts.settings': 'settings',
  'shortcuts.paste': 'paste a link and detect',
  'shortcuts.help': 'this list',
  'shortcuts.escape': 'clear / close',

  // ---- capabilities panel ----
  'cap.title': 'what this does',
  'cap.link.title': 'paste any link',
  'cap.link.body':
    '1800+ sites natively, and for the rest the app reads the page — or watches it in a hidden browser — to find the stream itself.',
  'cap.search.title': 'search by title',
  'cap.search.body': 'YouTube, SoundCloud, Dailymotion, Bilibili, Niconico, anime and more, at once.',
  'cap.trim.title': 'cut before you download',
  'cap.trim.body':
    'Pick a start and end — only that part is fetched. Already-downloaded files can be trimmed too.',
  'cap.convert.title': 'convert anything',
  'cap.convert.body': 'MP4, MKV, WebM, MOV, GIF, or extract audio as MP3, FLAC, OPUS…',
  'cap.channel.title': 'whole channels & playlists',
  'cap.channel.body': 'Paste a channel or playlist link and queue all of it — or just a range.',
  'cap.browser.title': 'built-in browser',
  'cap.browser.body':
    'Nothing found automatically? Browse to the video, click it, and download it by hand.',

  // ---- trim ----
  'trim.title': 'trim',
  'trim.enable': 'cut a section',
  'trim.start': 'from',
  'trim.end': 'to',
  'trim.end.full': 'end',
  'trim.length': 'length',
  'trim.reset': 'whole video',
  'trim.precise': 'exact cut',
  'trim.fast': 'fast cut',
  'trim.preciseHint': 're-encodes so the cut lands exactly here — slower, but no leftover intro',
  'trim.fastHint':
    'copies the stream — near-instant, but the clip can start seconds early and run longer than asked',
  'trim.downloadHint': 'only the selected part is downloaded',
  'trim.invalid': 'the end must come after the start',
  'trim.apply': 'trim',
  'trim.openEditor': 'trim',

  // ---- convert ----
  'convert.title': 'convert',
  'convert.open': 'convert',
  'convert.format': 'format',
  'convert.resolution': 'resolution',
  'convert.keepResolution': 'keep',
  'convert.apply': 'convert',
  'convert.gifHint': 'GIFs get large fast — trim to a few seconds first',
  'convert.noAudio': 'this file has no audio track, so only video formats are offered',

  // ---- queue job kinds ----
  'job.trim': 'trimming',
  'job.convert': 'converting',

  // ---- built-in browser ----
  'browser.open': 'open the built-in browser',
  'browser.openHint': 'browse to the video and grab it by hand',
  'browser.title': 'browser',
  'browser.urlPlaceholder': 'address or search',
  'browser.back': 'back',
  'browser.forward': 'forward',
  'browser.reload': 'reload',
  'browser.stop': 'stop',
  'browser.pick': 'pick the video',
  'browser.pickActive': 'click the video on the page…',
  'browser.pickHint': 'point at the player and click — Esc cancels',
  'browser.found': 'found on this page',
  'browser.foundNone': 'nothing yet',
  'browser.foundHint': 'play the video — streams show up here as the page requests them',
  'browser.downloadPage': 'download this page',
  'browser.clear': 'clear',
  'browser.openExternal': 'open in your browser',
  'browser.queued': 'added to the queue',

  /*
    The mono stamp that names each notice strip. Short by design — it is a
    category, not a sentence — but it is still a word, and an interface that
    is otherwise fully translated shouldn't have three English ones left in it.
  */
  'stamp.update': 'update',
  'stamp.clipboard': 'clipboard',

  // ---- screen reader announcements ----
  'a11y.scrollLeft': 'scroll left',
  'a11y.scrollRight': 'scroll right',
  'a11y.downloadFinished': '{title} finished downloading',
  'a11y.downloadFailed': '{title} failed. {error}',

  // ---- errors ----
  'error.title': 'something went wrong',
  'error.reload': 'reload the app',
  'error.starting': 'starting up…',

  /*
    Failures, in the user's own language.

    The engine only speaks English, so every one of these used to reach a
    Russian-speaking user untranslated — the interface was localised right up
    to the moment something broke, which is when the words matter most. The
    main process sends a code; these are what it means.
  */
  'err.unavailable':
    'This video is unavailable — it may have been removed, made private, or blocked in your region.',
  'err.ageRestricted': 'This content is age-restricted.',
  'err.rateLimited': 'The site is rate-limiting us. Wait a minute and retry, or set a proxy.',
  'err.signIn': 'This video requires you to be signed in.',
  'err.forbidden': 'The site refused the request.',
  'err.geo': 'This video is not available in your region.',
  'err.drm': 'This video is DRM-protected and cannot be downloaded.',
  'err.diskFull': 'Your disk is full — free some space and try again.',
  'err.permission': 'No permission to write to the download folder. Pick another one in settings.',
  'err.postprocess': 'Post-processing failed — the video arrived but could not be merged or converted.',
  'err.noFormats': 'Could not find a downloadable video at this link.',
  'err.network': 'Network problem reaching the site. Check your connection or proxy.',
  'err.timeout': 'The site took too long to answer. Check your connection or proxy.',
  'err.canceled': 'Canceled.',
  'err.sourceMissing': 'The source file is gone — it may have been moved or deleted.',
  'err.noAudioTrack': 'This file has no audio track, so it can’t become an audio file.',
  'err.damagedSource': 'The source file looks damaged or incomplete.',
  'err.unknownEncoder': 'The bundled ffmpeg can’t encode this format. Pick another one.',
  'err.ffmpegMissing': 'The bundled ffmpeg is missing — reinstall the app.',
  'err.streamGone': 'The stream this link pointed at is no longer there.',
  'err.corruptLink': 'This download link is corrupted — pick the video again.',
  'err.emptyPage': 'No videos found on this page.',
  'err.cookieHint': 'Try switching on browser cookies in settings → access.'
} as const

export type TranslationKey = keyof typeof en
export type Dictionary = Record<TranslationKey, string>
