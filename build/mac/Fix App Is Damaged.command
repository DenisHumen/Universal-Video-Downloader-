#!/bin/bash
# Universal Video Downloader: let macOS open the app.
#
# The app is not signed with a paid Apple developer certificate, so macOS
# quarantines it and may call it "damaged" or say it "can't be verified".
# It is not damaged. This removes the quarantine flag from the app, once per
# install or update, with the same command the README and the install window
# give. Double-click this file in the disk image; it opens in Terminal.

APP="/Applications/Universal Video Downloader.app"

# English unless the system or the shell says Russian.
lang=en
case "${LANG:-}" in ru*) lang=ru ;; esac
if [ "$lang" = en ]; then
  first=$(defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(),' | cut -c1-2)
  [ "$first" = ru ] && lang=ru
fi

say() {
  if [ "$lang" = ru ]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi
}

wait_key() {
  say "Press Enter to close this window." "Нажмите Enter, чтобы закрыть окно."
  read -r _
}

# The command itself, on a line of its own: the same text, exactly, as everywhere else.
run_fix() {
  xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app"
}

run_fix_sudo() {
  sudo xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app"
}

echo
say "Universal Video Downloader: allow the app to open" "Universal Video Downloader: разрешить запуск приложения"
echo

while [ ! -d "$APP" ]; do
  say "The app is not in Applications yet." "Приложения ещё нет в папке «Программы»."
  say "Drag \"Universal Video Downloader\" onto the Applications folder in the install window, then press Enter here." \
    "Перетащите «Universal Video Downloader» на папку «Программы» в окне установки, затем нажмите Enter здесь."
  read -r _
done

if out=$(run_fix 2>&1); then
  ok=1
else
  ok=0
  if printf '%s' "$out" | grep -qiE 'permission|not permitted'; then
    say "macOS refused: this account may not change files in Applications." \
      "macOS отказал: этой учётной записи нельзя менять файлы в «Программах»."
    say "The same command can run as an administrator (it will ask for your password)." \
      "Ту же команду можно выполнить от имени администратора (будет запрошен пароль)."
    say "Run it with sudo? [y/N]" "Выполнить через sudo? [y/N]"
    read -r answer
    case "$answer" in
      [yYдД]*) run_fix_sudo && ok=1 ;;
    esac
  else
    printf '%s\n' "$out"
  fi
fi

echo
if [ "$ok" = 1 ]; then
  say "Done. macOS will open the app now. This is needed once per install or update." \
    "Готово. Теперь macOS откроет приложение. Это нужно один раз после установки или обновления."
  say "Open Universal Video Downloader now? [Y/n]" "Открыть Universal Video Downloader сейчас? [Y/n]"
  read -r answer
  case "$answer" in
    [nNнН]*) ;;
    *) open -a "$APP" ;;
  esac
else
  say "It did not work. Open the guide \"How to open on macOS.pdf\" in the install window." \
    "Не получилось. Откройте инструкцию «How to open on macOS.pdf» в окне установки."
fi
echo
wait_key
