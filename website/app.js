/*
  The site's behaviour: the language, the download that fits this computer,
  every version from releases.json (written at deploy, so a visit costs GitHub
  nothing; the API is the fallback), and arrivals that animate once.
*/
;(function () {
  'use strict'

  var REPO = 'DenisHumen/Universal-Video-Downloader'
  var FIRST_RELEASES = 8

  var T = {
    en: {},
    ru: {
      skip: 'Перейти к содержимому',
      navLabel: 'Разделы',
      navFeatures: 'Возможности',
      navDownload: 'Скачать',
      navReleases: 'Все версии',
      langLabel: 'Язык',
      themeToDay: 'Включить дневную тему',
      themeToNight: 'Включить ночную тему',
      heroTitle: 'Скачивайте видео почти с любого сайта',
      heroLead:
        'Вставьте ссылку, выберите качество, нажмите «Скачать». YouTube и тысячи других сайтов: с субтитрами, только звук, нужный фрагмент, а новые серии сериала — сами, как только выйдут. Бесплатно, без рекламы и регистрации.',
      heroDownload: 'Скачать',
      heroMeta: 'Для Windows, macOS и Linux',
      heroOther: 'Другие системы и версии',
      tourPlay: 'Смотреть обзор',
      tourCaption:
        'Обзор за 20 секунд: ссылка вставлена и распознана, очередь загрузок, библиотека, поиск по названию, сериал в слежении, палитра команд и настройки.',
      featuresTitle: 'Всё в одном окне',
      f1Title: 'Вставьте ссылку',
      f1Body:
        'Больше 1800 сайтов работают напрямую. Для остальных приложение само читает страницу или открывает её в скрытом браузере и находит поток. Выберите видео или только звук, качество, субтитры и нужный кусок.',
      f2Title: 'Поиск по названию',
      f2Body:
        'Вместо ссылки напишите, что ищете: YouTube, SoundCloud, Dailymotion, Bilibili, Niconico и аниме-каталоги сразу, с лучшим качеством каждого результата ещё до скачивания.',
      f3Title: 'Очередь, которая следит за собой',
      f3Body:
        'Несколько загрузок сразу, пауза и продолжение, повтор при обрыве связи, а если что-то не так — понятная фраза и кнопка, которая это исправляет. Закрыли приложение посреди загрузки — оно продолжит в следующий раз.',
      f4Title: 'Новые серии сами',
      f4Body:
        'Следите за сериалом, каналом или плейлистом. Новые серии находятся по расписанию, скачиваются, переименовываются, отправляются в сетевую папку и приходят уведомлением в Telegram, пока приложение в трее.',
      f5Title: 'Ваша библиотека',
      f5Body:
        'Всё скачанное — по дате или по сайту: воспроизвести, показать в папке, обрезать, конвертировать. Перенесли папку — одна кнопка «Найти» находит остальное.',
      moreTitle: 'А ещё',
      m1t: 'Войти один раз',
      m1b: 'Видео только для подписчиков и с проверкой возраста: войдите во встроенном браузере или перенесите входы из своего браузера.',
      m2t: 'Конвертация и обрезка',
      m2b: 'MP4, MKV, WebM, MOV, GIF или звук в MP3, FLAC и Opus. Вырежьте фрагмент до или после скачивания.',
      m3t: 'Команда в терминале',
      m3b: '<code>uvd &lt;ссылка&gt;</code> скачивает с теми же настройками, что и приложение, — для скриптов и быстрых задач.',
      m4t: 'Расширение для браузера',
      m4b: 'Отправьте открытую страницу или ссылку в приложение одним нажатием.',
      m5t: 'Выглядит как родное',
      m5b: 'Сделано по образцу GNOME в Ubuntu: дневная и ночная тема и десять цветов акцента. Так же на Windows и macOS.',
      m6t: 'Ничего не уходит без вас',
      m6b: 'Без аккаунта, рекламы и слежки. Отчёт об ошибке отправляется только по вашему нажатию, и вы видите, что в нём.',
      downloadTitle: 'Скачать',
      latestIs: 'Последняя версия:',
      winReq: 'Windows 10 или 11, 64 бита',
      macReq: 'macOS 13 или новее',
      macNote:
        'Если macOS пишет, что приложение повреждено, откройте <em>Fix App Is Damaged.command</em> из образа диска. На macOS 11 и 12 используйте версию 3.26.2.',
      linuxReq: 'Ubuntu, Debian, Mint, Fedora, openSUSE и другие, x86-64',
      reposTitle: 'Установить из репозитория и обновлять вместе с системой',
      reposLead: 'Репозитории подписаны: обновления приходят с sudo apt upgrade или sudo dnf upgrade.',
      copy: 'Копировать',
      copied: 'Скопировано',
      releasesTitle: 'Все версии',
      releasesLead: 'Каждая версия с файлами для всех систем. Самая новая — сверху.',
      loading: 'Загружаю список версий…',
      showAll: 'Показать все версии',
      onGithub: 'Описание версий на GitHub',
      footer1: 'Бесплатно и с открытым кодом по лицензии MIT.',
      source: 'Исходный код',
      report: 'Сообщить о проблеме',
      footer2: 'Universal Video Downloader работает на yt-dlp и ffmpeg. Скачивайте только то, что вправе хранить.',
      // made in JS
      forWindows: 'Скачать для Windows',
      forMacArm: 'Скачать для Mac с Apple silicon',
      forMacIntel: 'Скачать для Mac с Intel',
      forDeb: 'Скачать для Ubuntu и Debian (.deb)',
      forRpm: 'Скачать для Fedora и openSUSE (.rpm)',
      yours: 'Ваша система',
      notDesktop: 'Это приложение для компьютера: откройте страницу на Windows, macOS или Linux.',
      latest: 'Последняя',
      prerelease: 'Предварительная',
      noFiles: 'Файлов нет',
      loadFailed: 'Не удалось загрузить список версий.',
      macIntelLink: 'Mac с Intel',
      macArmLink: 'Mac с Apple silicon',
      kinds: {
        exe: 'Установщик Windows',
        'dmg-arm64': 'Mac · Apple silicon',
        'dmg-x64': 'Mac · Intel',
        deb: 'Linux · .deb',
        rpm: 'Linux · .rpm',
        appimage: 'Linux · AppImage'
      }
    }
  }
  var EN = {
    themeToDay: 'Switch to the day theme',
    themeToNight: 'Switch to the night theme',
    forWindows: 'Download for Windows',
    forMacArm: 'Download for Mac with Apple silicon',
    forMacIntel: 'Download for Mac with Intel',
    forDeb: 'Download for Ubuntu and Debian (.deb)',
    forRpm: 'Download for Fedora and openSUSE (.rpm)',
    yours: 'Your system',
    notDesktop: 'This is a desktop app: open this page on Windows, macOS or Linux.',
    latest: 'Latest',
    prerelease: 'Pre-release',
    noFiles: 'No files',
    loadFailed: 'Could not load the list of versions.',
    copied: 'Copied',
    macIntelLink: 'Mac with Intel',
    macArmLink: 'Mac with Apple silicon',
    kinds: {
      exe: 'Windows installer',
      'dmg-arm64': 'Mac · Apple silicon',
      'dmg-x64': 'Mac · Intel',
      deb: 'Linux · .deb',
      rpm: 'Linux · .rpm',
      appimage: 'Linux · AppImage'
    }
  }

  document.documentElement.classList.add('js')
  var lang = document.documentElement.lang === 'ru' ? 'ru' : 'en'
  var english = {}
  var releases = null
  var system = null

  function t(key) {
    if (lang === 'ru' && T.ru[key] !== undefined) return T.ru[key]
    if (EN[key] !== undefined) return EN[key]
    return english[key]
  }

  // ---- Language ----------------------------------------------------------
  function applyLanguage() {
    document.documentElement.lang = lang
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n')
      if (!(key in english)) english[key] = el.innerHTML
      el.innerHTML = lang === 'ru' && T.ru[key] ? T.ru[key] : english[key]
    })
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria')
      if (!(key in english)) english[key] = el.getAttribute('aria-label')
      el.setAttribute('aria-label', lang === 'ru' && T.ru[key] ? T.ru[key] : english[key])
    })
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-lang') === lang))
    })
    document.querySelectorAll('[data-shot]').forEach(function (pair) {
      var name = pair.getAttribute('data-shot')
      pair.querySelector('.night').src = shot(name, 'night')
      pair.querySelector('.day').src = shot(name, 'day')
    })
    var night = document.getElementById('tour')
    var day = document.getElementById('tour-day')
    if (night) night.poster = shot('detected', 'night')
    if (day) day.poster = shot('detected', 'day')
    labelThemeButton()
    if (releases) render()
  }

  // A screenshot of the app in the reader's language, in one theme.
  function shot(name, theme) {
    if (theme === 'night') return 'media/shots/' + (lang === 'ru' ? 'ru' : 'en') + '/' + name + '.png'
    return 'media/shots/' + (lang === 'ru' ? 'ru-day' : 'day') + '/' + name + '-day.png'
  }

  // ---- Day and night ------------------------------------------------------------
  var root = document.documentElement
  var systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  function theme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  }
  function labelThemeButton() {
    var b = document.getElementById('theme-toggle')
    if (b) b.setAttribute('aria-label', t(theme() === 'dark' ? 'themeToDay' : 'themeToNight'))
  }

  /*
    Both tours play side by side, one of them hidden, so a switch shows the same
    moment of the app in the other theme rather than a jump back to its start.
  */
  function syncTours() {
    var night = document.getElementById('tour')
    var day = document.getElementById('tour-day')
    if (!night || !day) return
    var shown = theme() === 'dark' ? night : day
    var other = shown === night ? day : night
    if (Math.abs(other.currentTime - shown.currentTime) > 0.15) other.currentTime = shown.currentTime
  }

  function setTheme(next, from) {
    if (next === theme()) return
    var apply = function () {
      syncTours()
      root.setAttribute('data-theme', next)
      labelThemeButton()
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (document.startViewTransition && !reduce) {
      // The new theme opens as a circle from the button, wide enough to reach the far corner.
      var r = from ? from.getBoundingClientRect() : { left: innerWidth, top: 0, width: 0, height: 0 }
      var x = r.left + r.width / 2
      var y = r.top + r.height / 2
      root.style.setProperty('--from-x', x + 'px')
      root.style.setProperty('--from-y', y + 'px')
      root.style.setProperty('--reach', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px')
      document.startViewTransition(apply)
      return
    }
    // Elsewhere the colours and the pictures fade across together.
    root.classList.add('theme-switching')
    apply()
    setTimeout(function () {
      root.classList.remove('theme-switching')
    }, 800)
  }

  var toggle = document.getElementById('theme-toggle')
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = theme() === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem('uvd-theme', next)
      } catch (e) {}
      setTheme(next, toggle)
    })
  }
  // Until the reader picks one, the page follows the system as it changes.
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener('change', function (e) {
      var saved = null
      try {
        saved = localStorage.getItem('uvd-theme')
      } catch (err) {}
      if (!saved) setTheme(e.matches ? 'dark' : 'light', null)
    })
  }

  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang')
      try {
        localStorage.setItem('uvd-lang', lang)
      } catch (e) {}
      applyLanguage()
    })
  })

  // ---- Which computer is this ---------------------------------------------
  function detect() {
    var ua = navigator.userAgent || ''
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
    var guess = { os: 'other', arch: 'x64', distro: 'deb' }
    if (/android|iphone|ipad|ipod/i.test(ua)) guess.os = 'mobile'
    else if (/win/i.test(platform) || /windows/i.test(ua)) guess.os = 'windows'
    else if (/mac/i.test(platform) || /mac os x/i.test(ua)) {
      guess.os = 'mac'
      // Every Mac sold since 2021 is Apple silicon; the browser is asked when it can say.
      guess.arch = 'arm64'
      try {
        var gl = document.createElement('canvas').getContext('webgl')
        var info = gl && gl.getExtension('WEBGL_debug_renderer_info')
        var renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
        if (/intel|amd|radeon|nvidia/i.test(renderer)) guess.arch = 'x64'
      } catch (e) {}
    } else if (/linux|x11/i.test(platform + ' ' + ua)) {
      guess.os = 'linux'
      if (/fedora|red hat|centos|suse|rocky|alma/i.test(ua)) guess.distro = 'rpm'
    }
    return guess
  }

  function refineArch() {
    var uad = navigator.userAgentData
    if (!uad || !uad.getHighEntropyValues || system.os !== 'mac') return Promise.resolve()
    return uad
      .getHighEntropyValues(['architecture'])
      .then(function (v) {
        if (v.architecture === 'arm') system.arch = 'arm64'
        else if (v.architecture === 'x86') system.arch = 'x64'
      })
      .catch(function () {})
  }

  // ---- Files of a release ---------------------------------------------------
  function kindOf(name) {
    if (/\.blockmap$|\.yml$|SHA256SUMS|\.zip$|Packages|Release|\.gpg$/i.test(name)) return null
    if (/\.exe$/i.test(name)) return 'exe'
    if (/\.dmg$/i.test(name)) return /arm64/i.test(name) ? 'dmg-arm64' : 'dmg-x64'
    if (/\.deb$/i.test(name)) return 'deb'
    if (/\.rpm$/i.test(name)) return 'rpm'
    if (/\.appimage$/i.test(name)) return 'appimage'
    return null
  }
  var ORDER = ['exe', 'dmg-arm64', 'dmg-x64', 'deb', 'rpm', 'appimage']

  function filesOf(release) {
    var out = {}
    ;(release.assets || []).forEach(function (a) {
      var k = kindOf(a.name)
      if (k && !out[k]) out[k] = a
    })
    return out
  }

  function size(bytes) {
    if (!bytes) return ''
    return (bytes / 1048576).toFixed(0) + ' ' + (lang === 'ru' ? 'МБ' : 'MB')
  }
  function date(iso) {
    try {
      return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    } catch (e) {
      return iso.slice(0, 10)
    }
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  function linkButton(asset, label, primary) {
    return (
      '<a class="btn' +
      (primary ? ' btn-suggested' : '') +
      '" href="' +
      esc(asset.url) +
      '"><span>' +
      esc(label) +
      '</span><span class="size">' +
      size(asset.size) +
      '</span></a>'
    )
  }

  // ---- Drawing ------------------------------------------------------------------
  function render() {
    var stable = releases.filter(function (r) {
      return !r.prerelease
    })
    var latest = stable[0] || releases[0]
    if (!latest) return
    var files = filesOf(latest)
    var kinds = t('kinds')

    document.getElementById('latest-version').textContent = latest.tag.replace(/^v/, '')
    document.getElementById('latest-date').textContent = date(latest.date)

    // The platform cards
    var groups = { windows: ['exe'], mac: ['dmg-arm64', 'dmg-x64'], linux: ['deb', 'rpm', 'appimage'] }
    Object.keys(groups).forEach(function (g) {
      var box = document.querySelector('[data-group="' + g + '"]')
      var mine = system.os === g
      var best = mine ? primaryKind() : null
      box.innerHTML = groups[g]
        .filter(function (k) {
          return files[k]
        })
        .map(function (k) {
          return linkButton(files[k], kinds[k], k === best)
        })
        .join('')
      var card = box.closest('.platform')
      card.classList.toggle('is-yours', mine)
      var badge = card.querySelector('.yours-badge')
      if (mine && !badge) {
        badge = document.createElement('span')
        badge.className = 'yours-badge'
        card.insertBefore(badge, card.querySelector('h3'))
      }
      if (badge) badge.textContent = mine ? t('yours') : ''
      if (badge && !mine) badge.remove()
    })

    // The one button at the top
    var link = document.getElementById('primary-link')
    var label = document.getElementById('primary-label')
    var meta = document.getElementById('primary-meta')
    var k = primaryKind()
    if (k && files[k]) {
      link.href = files[k].url
      label.textContent = t(
        { exe: 'forWindows', 'dmg-arm64': 'forMacArm', 'dmg-x64': 'forMacIntel', deb: 'forDeb', rpm: 'forRpm' }[k]
      )
      var other = ''
      if (k === 'dmg-arm64' && files['dmg-x64']) other = ' · <a href="' + esc(files['dmg-x64'].url) + '">' + t('macIntelLink') + '</a>'
      if (k === 'dmg-x64' && files['dmg-arm64']) other = ' · <a href="' + esc(files['dmg-arm64'].url) + '">' + t('macArmLink') + '</a>'
      meta.innerHTML = esc(latest.tag.replace(/^v/, '')) + ' · ' + size(files[k].size) + other
    } else if (system.os === 'mobile') {
      link.href = '#download'
      meta.textContent = t('notDesktop')
    }

    // Every version
    var list = document.getElementById('release-list')
    var shown = list.getAttribute('data-all') ? releases : releases.slice(0, FIRST_RELEASES)
    list.innerHTML = shown
      .map(function (r, i) {
        var f = filesOf(r)
        var items = ORDER.filter(function (x) {
          return f[x]
        })
          .map(function (x) {
            return (
              '<li><a href="' +
              esc(f[x].url) +
              '"><span>' +
              esc(kinds[x]) +
              '</span><span class="size">' +
              size(f[x].size) +
              '</span></a></li>'
            )
          })
          .join('')
        var tag = r === latest ? '<span class="tag">' + t('latest') + '</span>' : r.prerelease ? '<span class="tag">' + t('prerelease') + '</span>' : ''
        return (
          '<li><details class="release"' +
          (i === 0 ? ' open' : '') +
          '><summary><span class="ver">' +
          esc(r.tag.replace(/^v/, '')) +
          '</span>' +
          tag +
          '<span class="date">' +
          date(r.date) +
          '</span></summary>' +
          (items ? '<ul class="files">' + items + '</ul>' : '<p class="dim">' + t('noFiles') + '</p>') +
          '<p><a href="' +
          esc(r.url) +
          '">' +
          (lang === 'ru' ? 'Что нового' : 'What is new') +
          '</a></p></details></li>'
        )
      })
      .join('')
    list.removeAttribute('aria-busy')
    document.getElementById('more-releases').hidden = !!list.getAttribute('data-all') || releases.length <= FIRST_RELEASES
  }

  function primaryKind() {
    if (system.os === 'windows') return 'exe'
    if (system.os === 'mac') return system.arch === 'x64' ? 'dmg-x64' : 'dmg-arm64'
    if (system.os === 'linux') return system.distro
    return null
  }

  document.getElementById('more-releases').addEventListener('click', function () {
    document.getElementById('release-list').setAttribute('data-all', '1')
    render()
  })

  // ---- Where the versions come from -----------------------------------------
  function fromApi() {
    return fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=100', {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(function (list) {
        return list
          .filter(function (r) {
            return !r.draft
          })
          .map(function (r) {
            return {
              tag: r.tag_name,
              date: r.published_at,
              prerelease: r.prerelease,
              url: r.html_url,
              assets: r.assets.map(function (a) {
                return { name: a.name, size: a.size, url: a.browser_download_url }
              })
            }
          })
      })
  }

  function load() {
    return fetch('releases.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .catch(fromApi)
      .then(function (list) {
        releases = list
        render()
      })
      .catch(function () {
        var list = document.getElementById('release-list')
        list.innerHTML = '<li class="placeholder">' + esc(t('loadFailed')) + '</li>'
        list.removeAttribute('aria-busy')
      })
  }

  // ---- Copy buttons and the distribution tabs --------------------------------
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.parentElement.querySelector('code').textContent
      navigator.clipboard.writeText(text).then(function () {
        var was = b.textContent
        b.textContent = t('copied')
        setTimeout(function () {
          b.textContent = was
        }, 1600)
      })
    })
  })
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'))
  function select(tab) {
    tabs.forEach(function (x) {
      var on = x === tab
      x.setAttribute('aria-selected', String(on))
      x.tabIndex = on ? 0 : -1
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on
    })
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      select(tab)
    })
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
      select(next)
      next.focus()
    })
  })

  // ---- The tour: plays when seen, not for those who asked for less motion ----
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var tours = [document.getElementById('tour'), document.getElementById('tour-day')].filter(Boolean)
  var play = document.getElementById('tour-play')
  function playTours() {
    syncTours()
    tours.forEach(function (v) {
      v.play().catch(function () {})
    })
  }
  if (tours.length) {
    if (calm) {
      play.hidden = false
      play.addEventListener('click', function () {
        play.hidden = true
        playTours()
      })
    } else if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) playTours()
            else
              tours.forEach(function (v) {
                v.pause()
              })
          })
        },
        { threshold: 0.35 }
      ).observe(tours[0].closest('.window'))
      // Two decoders drift apart over a loop; a nudge now and then keeps them on one frame.
      setInterval(syncTours, 3000)
    }
  }

  // ---- Arrivals ------------------------------------------------------------------
  if ('IntersectionObserver' in window && !calm) {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return
          e.target.classList.add('is-in')
          seen.unobserve(e.target)
        })
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    document.querySelectorAll('.reveal').forEach(function (el, i) {
      el.style.transitionDelay = (el.closest('.platforms') ? (i % 3) * 70 : 0) + 'ms'
      seen.observe(el)
    })
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('is-in')
    })
  }

  system = detect()
  applyLanguage()
  refineArch().then(function () {
    if (releases) render()
  })
  load()
})()
