#!/bin/bash
# Universal Video Downloader: let macOS open the app.
#
# The app is not signed with a paid Apple developer certificate, so macOS
# quarantines it and may call it "damaged" or say it "can't be verified".
# It is not damaged. This removes the quarantine flag from the app, once per
# install or update, with the same command the README and the install window
# give. Double-click this file in the disk image; it opens in Terminal.

NAME="Universal Video Downloader.app"
APP="/Applications/$NAME"
# Installed for this account only: ~/Applications works the same way.
[ ! -d "$APP" ] && [ -d "$HOME/Applications/$NAME" ] && APP="$HOME/Applications/$NAME"

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

# The command itself: the same text as everywhere else, for wherever the app is.
# An app with no quarantine flag left has nothing to remove: that is success.
run_fix() {
  if [ "$APP" = "/Applications/$NAME" ]; then
    out=$(xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app" 2>&1) && return 0
  else
    out=$(xattr -dr com.apple.quarantine "$HOME/Applications/Universal Video Downloader.app" 2>&1) && return 0
  fi
  printf '%s' "$out" | grep -qi 'No such xattr' && return 0
  printf '%s' "$out" >&2
  return 1
}

run_fix_sudo() {
  if [ "$APP" = "/Applications/$NAME" ]; then
    out=$(sudo xattr -dr com.apple.quarantine "/Applications/Universal Video Downloader.app" 2>&1) && return 0
  else
    out=$(sudo xattr -dr com.apple.quarantine "$HOME/Applications/Universal Video Downloader.app" 2>&1) && return 0
  fi
  printf '%s' "$out" | grep -qi 'No such xattr' && return 0
  printf '%s\n' "$out"
  return 1
}

# Yes / no, matched per character (not single-byte classes, which split a
# Cyrillic letter): д/Д and н/Н as well as y/Y and n/N.
is_yes() { case "$1" in д*|Д*|y*|Y*) return 0 ;; esac; return 1; }
is_no() { case "$1" in н*|Н*|n*|N*) return 0 ;; esac; return 1; }

echo
say "Universal Video Downloader: allow the app to open" "Universal Video Downloader: разрешить запуск приложения"
echo

while [ ! -d "$APP" ]; do
  if [ -d "$HOME/Applications/$NAME" ]; then APP="$HOME/Applications/$NAME"; break; fi
  say "The app is not in Applications yet." "Приложения ещё нет в папке «Программы»."
  say "Drag \"Universal Video Downloader\" onto the Applications folder in the install window." \
    "Перетащите «Universal Video Downloader» на папку «Программы» в окне установки."
  say "Press Enter to check again, or type q and Enter to quit." \
    "Нажмите Enter, чтобы проверить ещё раз, или введите q и Enter, чтобы выйти."
  read -r answer || exit 1
  case "$answer" in q*|Q*|в*|В*) exit 0 ;; esac
done

if out=$(run_fix 2>&1 >/dev/null); then
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
    if is_yes "$answer"; then run_fix_sudo && ok=1; fi
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
  is_no "$answer" || open -a "$APP"
else
  say "It did not work. Open the guide \"How to open on macOS.pdf\" in the install window." \
    "Не получилось. Откройте инструкцию «How to open on macOS.pdf» в окне установки."
fi
echo
wait_key
