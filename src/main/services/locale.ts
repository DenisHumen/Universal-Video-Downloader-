import { app } from 'electron'
import { getSettings } from './settings'

/**
 * The handful of strings that live outside the renderer.
 *
 * The interface is fully translated — and then the menu bar, the tray menu and
 * every "Download complete" notification arrived in English regardless, because
 * those are drawn by the operating system from the main process, which had no
 * dictionary at all. This is that dictionary. It is deliberately tiny: nothing
 * belongs here that a React component could say instead.
 */

export type MainLanguage = 'en' | 'ru'

/** Locales where Russian is the shared reading language. Mirrors the renderer. */
const RUSSIAN_LOCALES = ['ru', 'be', 'uk', 'kk', 'ky', 'uz', 'tg', 'az', 'hy', 'mo']

export function currentLanguage(): MainLanguage {
  const preference = getSettings().language
  if (preference === 'en' || preference === 'ru') return preference
  const base = (app.getLocale() || 'en').toLowerCase().split(/[-_]/)[0]
  return RUSSIAN_LOCALES.includes(base) ? 'ru' : 'en'
}

const EN = {
  'menu.settings': 'Settings',
  'menu.newDownload': 'New download',
  'menu.searchByTitle': 'Search by title',
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.downloads': 'Downloads',
  'menu.queue': 'Queue',
  'menu.pauseAll': 'Pause all',
  'menu.resumeAll': 'Resume all',
  'menu.help': 'Help',
  'menu.github': 'Project on GitHub',
  'menu.issue': 'Report an issue',
  'tray.open': 'Open',
  'tray.quit': 'Quit',
  'notify.done': 'Download complete',
  'notify.failed': 'Download failed'
} as const

export type MainKey = keyof typeof EN

const RU: Record<MainKey, string> = {
  'menu.settings': 'Настройки',
  'menu.newDownload': 'Новая загрузка',
  'menu.searchByTitle': 'Поиск по названию',
  'menu.file': 'Файл',
  'menu.edit': 'Правка',
  'menu.view': 'Вид',
  'menu.downloads': 'Загрузки',
  'menu.queue': 'Очередь',
  'menu.pauseAll': 'Приостановить все',
  'menu.resumeAll': 'Продолжить все',
  'menu.help': 'Справка',
  'menu.github': 'Проект на GitHub',
  'menu.issue': 'Сообщить о проблеме',
  'tray.open': 'Открыть',
  'tray.quit': 'Выход',
  'notify.done': 'Загрузка завершена',
  'notify.failed': 'Загрузка не удалась'
}

const DICTIONARIES: Record<MainLanguage, Record<MainKey, string>> = { en: EN, ru: RU }

export function mt(key: MainKey): string {
  return DICTIONARIES[currentLanguage()][key] ?? EN[key]
}
