import type { Dictionary } from './en'

/** Русская локализация. Тон — такой же строчный и спокойный, как в оригинале. */
export const ru: Dictionary = {
  // ---- common ----
  'common.cancel': 'отмена',
  'common.close': 'закрыть',
  'common.retry': 'повторить',
  'common.remove': 'удалить',
  'common.pause': 'пауза',
  'common.resume': 'продолжить',
  'common.play': 'воспроизвести',
  'common.open': 'открыть',
  'common.openInBrowser': 'открыть в браузере',
  'common.showInFolder': 'показать в папке',
  'common.copy': 'копировать',
  'common.copied': 'скопировано',
  'common.all': 'все',
  'common.clear': 'очистить',
  'common.download': 'скачать',
  'common.search': 'найти',
  'common.best': 'лучшее',
  'common.video': 'видео',
  'common.audioOnly': 'только звук',
  'common.quality': 'качество',
  'common.format': 'формат',
  'common.change': 'изменить',
  'common.check': 'проверить',
  'common.update': 'обновить',
  'common.off': 'выкл',
  'common.paste': 'вставить из буфера',

  // ---- navigation ----
  'nav.home': 'скачать',
  'nav.queue': 'очередь',
  'nav.search': 'поиск',
  'nav.settings': 'настройки',

  // ---- title bar ----
  'engine.ready': 'движок готов',
  'engine.downloading': 'движок {percent}%',
  'engine.checking': 'движок…',
  'engine.error': 'ошибка движка',
  'engine.idle': 'движок',
  'engine.setupLabel': 'установка',
  'engine.setupTitle': 'готовлю движок загрузок',
  'engine.setupOnce': 'один раз, около 30 МБ',
  'engine.setupFailed': 'не удалось установить движок загрузок',

  // ---- home ----
  'home.title': 'вставьте ссылку — получите видео',
  'home.subtitle': 'автоопределение потока для тысяч сайтов — или введите название для поиска.',
  'home.placeholder': 'вставьте ссылку на видео — или найдите по названию',
  'home.linkLabel': 'ссылка на видео',
  'home.saveDefault': 'папка по умолчанию',
  'home.get': 'получить',
  'home.errorTitle': 'не удалось найти видео',
  'home.openAccessSettings': 'открыть настройки → доступ',
  'home.batch': 'несколько ссылок',
  'home.batchHint': 'по одной ссылке в строке — каждая станет отдельной загрузкой',
  'home.batchAdd': 'в очередь: {count}',
  'home.batchOpen': 'вставить сразу несколько ссылок',
  'home.universal': 'найдено универсальным определением',
  'home.universalHint':
    'движок не знает этот сайт, поэтому приложение само открыло страницу и перехватило поток.',
  'home.clipboardFound': 'в буфере обмена ссылка',
  'home.clipboardUse': 'использовать',
  'home.addedToQueue': 'добавлено в очередь',
  'home.startFailed': 'не удалось запустить загрузку',
  'home.liveHint':
    'это прямой эфир — запись идёт с этого момента и до остановки, поэтому обрезать нечего и процент показать не из чего.',

  // ---- detection stages ----
  'detect.resolving': 'проверяю ссылку…',
  'detect.engine': 'спрашиваю движок…',
  'detect.scraping': 'читаю страницу…',
  'detect.browsing': 'открываю страницу, ищу поток…',
  'detect.probing': 'читаю параметры потока…',
  'detect.slowHint': 'незнакомый сайт — это может занять до полуминуты.',

  // ---- queue ----
  'queue.title': 'очередь',
  'queue.items': 'записей: {count}',
  'queue.item': '{count} запись',
  'queue.empty': 'здесь пока пусто',
  'queue.emptyHint': 'вставьте ссылку, чтобы начать',
  'queue.emptyFiltered': 'по этому фильтру ничего нет',
  'queue.emptyFilteredHint': 'попробуйте другой фильтр или очистите поиск',
  'queue.clearFilters': 'показать все',
  'queue.add': 'добавить загрузку',
  'queue.openFolder': 'открыть папку',
  'queue.clearFinished': 'убрать завершённые',
  'queue.pauseAll': 'пауза для всех',
  'queue.resumeAll': 'продолжить все',
  'queue.retryFailed': 'повторить неудачные',
  'queue.filterAll': 'все',
  'queue.filterActive': 'активные',
  'queue.filterDone': 'готовые',
  'queue.filterFailed': 'с ошибкой',
  'queue.searchPlaceholder': 'фильтр по названию…',
  'queue.remaining': 'осталось {size}',
  'queue.eta': 'осталось {time}',
  'queue.etaAll': '≈ {time} до конца',
  'queue.duplicate': 'уже в очереди',
  'queue.addedWithDuplicates': 'добавлено: {count} · уже в очереди: {duplicates}',
  'queue.copyLink': 'скопировать ссылку',
  'queue.openSource': 'открыть страницу-источник',
  'queue.moveUp': 'скачать следующим',
  'queue.next': 'следующий',
  'queue.log': 'вывод движка',
  'queue.copyError': 'скопировать ошибку',
  'queue.retryingIn': 'повторяю автоматически…',

  // ---- download states ----
  'state.queued': 'в очереди',
  'state.detecting': 'подготовка',
  'state.downloading': 'скачивается',
  'state.processing': 'обработка',
  'phase.trim': 'обрезаю',
  'phase.merge': 'склеиваю',
  'phase.convert': 'конвертирую',
  'state.completed': 'готово',
  'state.error': 'ошибка',
  'state.paused': 'пауза',
  'state.canceled': 'отменено',

  // ---- playlist ----
  'playlist.videos': 'видео: {count}',
  'playlist.downloadAll': 'скачать все ({count})',
  'playlist.selected': 'скачать выбранные ({count})',
  'playlist.selectAll': 'выбрать все',
  'playlist.range': 'номера',
  'playlist.selectRange': 'выбрать диапазон',
  'playlist.added': 'добавлено видео: {count}',

  // ---- streaming picker ----
  'streaming.voiceover': 'озвучка',
  'streaming.season': 'сезон',
  'streaming.episodes': 'серии',
  'streaming.quality': 'качество',
  'streaming.premium': 'премиум',
  'streaming.premiumHint': 'нужна подписка — скачать нельзя',
  'streaming.series': 'сериал',
  'streaming.seriesSeasons': 'сериал · сезонов: {count}',
  'streaming.movie': 'фильм',
  'streaming.selectEpisode': 'выберите хотя бы одну серию',

  // ---- format selector ----
  'format.exactStream': 'выбрать конкретный поток ({count})',
  'format.audioFormat': 'формат звука',
  'format.plusAudio': '+ звук',
  'format.upTo': 'до {height}p',
  'format.youGet': 'получите',
  'format.subtitles': 'дорожек субтитров: {count}',

  // ---- search ----
  'search.title': 'поиск по всем сервисам',
  'search.hint': 'видео, музыка и аниме — введите название и нажмите enter',
  'search.placeholder': 'поиск видео, музыки и аниме по названию',
  'search.services': 'сервисы',
  'search.allServices': 'все сервисы',
  'search.searching': 'ищу: {service}',
  'search.results': 'результатов: {count}',
  'search.nothing': 'ничего не найдено',
  'search.nothingHint': 'попробуйте другие слова',
  'search.failed': 'поиск не удался',
  'search.episodes': 'серии',
  'search.queued': 'в очереди',
  'search.qualityProbe': 'качество…',
  'search.anime': 'аниме',
  'search.audio': 'звук',

  // ---- settings ----
  'settings.title': 'настройки',
  'settings.section.appearance': 'внешний вид',
  'settings.section.downloads': 'загрузки',
  'settings.section.processing': 'обработка',
  'settings.section.detection': 'определение',
  'settings.section.access': 'доступ и cookies',
  'settings.section.network': 'сеть',
  'settings.section.system': 'система',
  'settings.section.updates': 'обновления',
  'settings.section.about': 'о программе',

  'settings.language': 'язык',
  'settings.language.auto': 'как в системе',
  'settings.theme': 'тема',
  'settings.theme.night': 'ночь',
  'settings.theme.day': 'день',

  'settings.saveLocation': 'папка загрузок',
  'settings.subfolders': 'раскладывать по папкам',
  'settings.subfoldersHint': 'отдельная папка для каждого сайта',
  'settings.defaultMode': 'режим по умолчанию',
  'settings.defaultQuality': 'качество по умолчанию',
  'settings.defaultQualityHint':
    'лучшее = автоматически берём максимум, который есть у видео. фиксированный выбор сам опустится до лучшего доступного.',
  'settings.audioFormat': 'формат звука',
  'settings.audioFormatHint': 'для загрузок «только звук»',
  'settings.concurrent': 'одновременных загрузок',
  'settings.resumeOnLaunch': 'продолжать прерванные загрузки',
  'settings.resumeOnLaunchHint':
    'если приложение закрыли во время загрузки — продолжить её при следующем запуске. то, что вы поставили на паузу сами, останется на паузе.',
  'settings.speedLimit': 'ограничение скорости',
  'settings.speedLimitHint': 'например 2M или 500K — пусто = без ограничений',
  'settings.playlistLimit': 'глубина каналов и плейлистов',
  'settings.playlistLimitHint':
    'сколько видео перечислять, когда вы вставляете ссылку на канал или плейлист',

  'settings.embedThumbnail': 'встроить обложку',
  'settings.embedThumbnailHint': 'добавляет картинку в файл',
  'settings.embedMetadata': 'встроить метаданные',
  'settings.embedMetadataHint': 'название, автор, описание',
  'settings.embedChapters': 'встроить главы',
  'settings.embedChaptersHint': 'метки перехода внутри файла',
  'settings.embedSubtitles': 'встроить субтитры',
  'settings.embedSubtitlesHint': 'вшить дорожки субтитров в файл',
  'settings.writeSubtitles': 'сохранять субтитры файлами',
  'settings.writeSubtitlesHint': 'отдельные .srt рядом с видео',
  'settings.subtitleLanguages': 'языки субтитров',
  'settings.subtitleLanguagesHint': 'коды через запятую или «all»',
  'settings.sponsorBlock': 'вырезать рекламные вставки',
  'settings.sponsorBlockHint': 'убирает спонсорские и саморекламные фрагменты (YouTube)',
  'settings.restrictFilenames': 'упрощать имена файлов',
  'settings.restrictFilenamesHint': 'только ascii, без пробелов',
  'settings.filenameTemplate': 'шаблон имени файла',
  'settings.filenameTemplateHint': 'шаблон вывода yt-dlp',

  'settings.universal': 'универсальное определение',
  'settings.universalHint':
    'если движок не знает сайт — открыть страницу в скрытом окне браузера и перехватить поток. именно это заставляет работать сайты без отдельной поддержки; выключите, если не хотите, чтобы приложение само загружало страницы.',

  'settings.cookies': 'брать cookies из браузера',
  'settings.cookiesHint':
    'многие сайты (в том числе для взрослых) прячут видео за проверкой возраста или входом — укажите браузер, где вы авторизованы. закройте этот браузер на время загрузки.',
  'settings.cookiesFile': 'файл cookies.txt',
  'settings.cookiesFileHint': 'имеет приоритет над браузером выше',
  'settings.cookiesFileChoose': 'выбрать файл',
  'settings.cookiesFileClear': 'убрать',

  'settings.proxy': 'прокси',
  'settings.proxyPlaceholder': 'http://host:port (необязательно)',

  'settings.notifications': 'уведомления',
  'settings.notificationsHint': 'сообщать о завершении загрузки',
  'settings.clipboardWatch': 'следить за буфером обмена',
  'settings.clipboardWatchHint': 'предлагать скачать ссылки, скопированные в других программах',
  'settings.tray': 'оставаться в трее',
  'settings.trayHint': 'закрытие окна не прерывает загрузки',

  'settings.autoUpdate': 'автообновление приложения',
  'settings.autoUpdateHint': 'проверять при запуске и сообщать',
  'settings.appVersion': 'версия приложения',
  'settings.updateAvailable': 'доступно обновление {version}',
  'settings.upToDate': 'у вас последняя версия',
  'settings.engine': 'движок загрузок',
  'settings.manualUpdates': 'эта сборка обновляется вручную',
  'settings.manualUpdatesHint': 'мы откроем страницу загрузок за вас',

  'settings.about':
    'работает на открытом движке yt-dlp и ffmpeg. пожалуйста, соблюдайте правила сайтов и авторские права.',
  'settings.viewOnGithub': 'открыть на github',
  'settings.reset': 'сбросить все настройки',
  'settings.resetDone': 'настройки сброшены',

  // ---- update banner ----
  'update.available': 'доступна версия {version}',
  'update.availableHint': 'можно скачать и установить',
  'update.availableManualHint': 'откроется страница загрузки в браузере',
  'update.downloading': 'скачиваю обновление…',
  'update.ready': 'обновление {version} готово',
  'update.readyHint': 'приложение перезапустится, чтобы применить его',
  'update.action': 'обновить',
  'update.restart': 'перезапустить',
  'update.getIt': 'скачать',

  // ---- mac notice ----
  'mac.title': 'macOS пишет, что приложение «повреждено» или не открывается?',
  'mac.why':
    'на самом деле нет — сборка без подписи, поэтому macOS помещает её в карантин. выполните один раз в терминале:',

  // ---- shortcuts ----
  'shortcuts.title': 'горячие клавиши',
  'shortcuts.newDownload': 'новая загрузка',
  'shortcuts.queue': 'открыть очередь',
  'shortcuts.search': 'поиск по названию',
  'shortcuts.settings': 'настройки',
  'shortcuts.paste': 'вставить ссылку и определить',
  'shortcuts.help': 'этот список',
  'shortcuts.escape': 'очистить / закрыть',

  // ---- capabilities panel ----
  'cap.title': 'что умеет приложение',
  'cap.link.title': 'вставьте любую ссылку',
  'cap.link.body':
    '1800+ сайтов напрямую, а для остальных приложение само читает страницу — или смотрит её в скрытом браузере — и находит поток.',
  'cap.search.title': 'поиск по названию',
  'cap.search.body': 'YouTube, SoundCloud, Dailymotion, Bilibili, Niconico, аниме и другое — сразу.',
  'cap.trim.title': 'обрезать до скачивания',
  'cap.trim.body':
    'Укажите начало и конец — скачается только этот кусок. Уже скачанные файлы тоже можно обрезать.',
  'cap.convert.title': 'конвертация',
  'cap.convert.body': 'MP4, MKV, WebM, MOV, GIF или звук отдельно — MP3, FLAC, OPUS…',
  'cap.channel.title': 'целые каналы и плейлисты',
  'cap.channel.body': 'Вставьте ссылку на канал или плейлист и поставьте в очередь всё — или диапазон.',
  'cap.browser.title': 'встроенный браузер',
  'cap.browser.body':
    'Ничего не нашлось автоматически? Дойдите до видео, кликните по нему и заберите вручную.',

  // ---- trim ----
  'trim.title': 'обрезка',
  'trim.enable': 'вырезать фрагмент',
  'trim.start': 'с',
  'trim.end': 'по',
  'trim.end.full': 'конец',
  'trim.length': 'длина',
  'trim.reset': 'всё видео',
  'trim.precise': 'точный рез',
  'trim.preciseHint': 'перекодирует, чтобы рез был ровно здесь — дольше, но заставка не останется',
  'trim.fastHint':
    'копирует поток — почти мгновенно, но клип может начаться на несколько секунд раньше и выйти длиннее',
  'trim.downloadHint': 'скачается только выбранный кусок',
  'trim.invalid': 'конец должен быть после начала',
  'trim.apply': 'обрезать',
  'trim.openEditor': 'обрезать',

  // ---- convert ----
  'convert.title': 'конвертация',
  'convert.open': 'конвертировать',
  'convert.format': 'формат',
  'convert.resolution': 'разрешение',
  'convert.keepResolution': 'как есть',
  'convert.apply': 'конвертировать',
  'convert.gifHint': 'GIF быстро становится огромным — сначала обрежьте до нескольких секунд',
  'convert.noAudio': 'в файле нет звуковой дорожки — доступны только видеоформаты',

  // ---- queue job kinds ----
  'job.trim': 'обрезка',
  'job.convert': 'конвертация',

  // ---- built-in browser ----
  'browser.open': 'открыть встроенный браузер',
  'browser.openHint': 'дойдите до видео и заберите его вручную',
  'browser.title': 'браузер',
  'browser.urlPlaceholder': 'адрес или поиск',
  'browser.back': 'назад',
  'browser.forward': 'вперёд',
  'browser.reload': 'обновить',
  'browser.stop': 'стоп',
  'browser.pick': 'указать видео',
  'browser.pickActive': 'кликните по видео на странице…',
  'browser.pickHint': 'наведите на плеер и кликните — Esc отменяет',
  'browser.found': 'найдено на странице',
  'browser.foundNone': 'пока ничего',
  'browser.foundHint': 'запустите видео — потоки появятся здесь, как только страница их запросит',
  'browser.downloadPage': 'скачать эту страницу',
  'browser.clear': 'очистить',
  'browser.openExternal': 'открыть во внешнем браузере',
  'browser.queued': 'добавлено в очередь',

  // ---- screen reader announcements ----
  'a11y.downloadFinished': '{title} — загрузка завершена',
  'a11y.downloadFailed': '{title} — ошибка. {error}',

  // ---- errors ----
  'error.title': 'что-то пошло не так',
  'error.reload': 'перезагрузить приложение',
  'error.starting': 'запускаемся…',

  /*
    Ошибки — на языке пользователя.

    Движок говорит только по-английски, и раньше любая неудача приходила
    именно так: интерфейс переведён целиком ровно до момента, когда что-то
    ломается — а это как раз тот момент, когда слова важнее всего.
  */
  'err.unavailable':
    'видео недоступно — возможно, его удалили, сделали приватным или закрыли для вашего региона.',
  'err.ageRestricted': 'контент с возрастным ограничением.',
  'err.rateLimited': 'сайт ограничивает частоту запросов. подождите минуту или укажите прокси.',
  'err.signIn': 'для этого видео нужно быть авторизованным на сайте.',
  'err.forbidden': 'сайт отклонил запрос.',
  'err.geo': 'видео недоступно в вашем регионе.',
  'err.drm': 'видео защищено DRM — скачать его нельзя.',
  'err.diskFull': 'на диске нет места — освободите его и попробуйте снова.',
  'err.permission': 'нет прав на запись в папку загрузок. выберите другую в настройках.',
  'err.postprocess': 'постобработка не удалась — видео скачалось, но не собралось.',
  'err.noFormats': 'по этой ссылке не нашлось видео, которое можно скачать.',
  'err.network': 'проблема с сетью. проверьте подключение или прокси.',
  'err.timeout': 'сайт слишком долго не отвечает. проверьте подключение или прокси.',
  'err.canceled': 'отменено.',
  'err.sourceMissing': 'исходный файл пропал — возможно, его переместили или удалили.',
  'err.noAudioTrack': 'в файле нет звуковой дорожки, поэтому аудиофайл из него не получится.',
  'err.damagedSource': 'исходный файл повреждён или скачан не полностью.',
  'err.unknownEncoder': 'встроенный ffmpeg не умеет кодировать этот формат. выберите другой.',
  'err.ffmpegMissing': 'встроенный ffmpeg не найден — переустановите приложение.',
  'err.streamGone': 'потока по этой ссылке больше нет.',
  'err.corruptLink': 'ссылка на загрузку повреждена — выберите видео заново.',
  'err.emptyPage': 'на этой странице не нашлось видео.',
  'err.cookieHint': 'попробуйте включить cookies браузера в настройках → доступ.'
}
