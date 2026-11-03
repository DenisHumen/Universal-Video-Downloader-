/// <reference types="vite/client" />
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'

/**
 * The app's icon set (plan 3.2, A1 D4, A1.2 Y4): Yaru's symbolic icons, the
 * ones the user's GNOME draws, shipped as separate SVG files in
 * resources/icons/yaru/ under CC-BY-SA-4.0 (attribution in About › Legal and
 * THIRD_PARTY_NOTICES.txt; licence text beside the files). Never inlined
 * (E5): Vite emits each as its own asset and the icon is a CSS mask of it,
 * painted in `currentColor`, so a symbolic icon takes the text colour exactly
 * as GTK recolours one.
 *
 * Everything outside `ui/` imports icons from here (ui.test.tsx enforces it).
 * The export names are the ones the code already used (they began as lucide
 * names); new code may use the GNOME-named ones at the end.
 */

const FILES = import.meta.glob('../../../../resources/icons/yaru/*.svg', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

function urlOf(file: string): string {
  const hit = Object.entries(FILES).find(([path]) => path.endsWith(`/${file}`))
  if (!hit) throw new Error(`icon ${file} is not in resources/icons/yaru`)
  return hit[1]
}

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Pixels; GNOME's symbolic grid is 16. */
  size?: number
  /** Accepted and ignored: symbolic icons have a fixed stroke. Kept so older call sites compile. */
  strokeWidth?: number
}

export type IconComponent = ReturnType<typeof symbolic>

function symbolic(file: string, name: string) {
  const url = urlOf(file)
  const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { size = 16, strokeWidth, className, style, ...rest },
    ref
  ) {
    return (
      <span
        ref={ref}
        aria-hidden={rest['aria-label'] ? undefined : true}
        data-icon={name}
        className={className ? `uvd-icon ${className}` : 'uvd-icon'}
        style={{ width: size, height: size, ['--icon' as string]: `url("${url}")`, ...style } as CSSProperties}
        {...rest}
      />
    )
  })
  Icon.displayName = name
  return Icon
}

export const AlertCircle = symbolic('dialog-error-symbolic.svg', 'AlertCircle')
export const AlertTriangle = symbolic('dialog-warning-symbolic.svg', 'AlertTriangle')
export const ArrowDownToLine = symbolic('folder-download-symbolic.svg', 'ArrowDownToLine')
export const ArrowLeft = symbolic('go-previous-symbolic.svg', 'ArrowLeft')
export const ArrowRight = symbolic('go-next-symbolic.svg', 'ArrowRight')
export const ArrowUp = symbolic('go-up-symbolic.svg', 'ArrowUp')
export const ArrowUpRight = symbolic('adw-external-link-symbolic.svg', 'ArrowUpRight')
export const CalendarClock = symbolic('alarm-symbolic.svg', 'CalendarClock')
export const Check = symbolic('object-select-symbolic.svg', 'Check')
export const CheckCircle2 = symbolic('emblem-ok-symbolic.svg', 'CheckCircle2')
export const ChevronDown = symbolic('pan-down-symbolic.svg', 'ChevronDown')
export const ChevronLeft = symbolic('pan-start-symbolic.svg', 'ChevronLeft')
export const ChevronRight = symbolic('pan-end-symbolic.svg', 'ChevronRight')
export const CircleX = symbolic('process-stop-symbolic.svg', 'CircleX')
export const ClipboardPaste = symbolic('edit-paste-symbolic.svg', 'ClipboardPaste')
export const Clock = symbolic('preferences-system-time-symbolic.svg', 'Clock')
export const Copy = symbolic('edit-copy-symbolic.svg', 'Copy')
export const Crosshair = symbolic('find-location-symbolic.svg', 'Crosshair')
export const Download = symbolic('folder-download-symbolic.svg', 'Download')
export const ExternalLink = symbolic('adw-external-link-symbolic.svg', 'ExternalLink')
export const FileVideo = symbolic('video-x-generic-symbolic.svg', 'FileVideo')
export const Film = symbolic('camera-video-symbolic.svg', 'Film')
export const Folder = symbolic('folder-symbolic.svg', 'Folder')
export const FolderOpen = symbolic('folder-open-symbolic.svg', 'FolderOpen')
export const FolderUp = symbolic('folder-remote-symbolic.svg', 'FolderUp')
export const Github = symbolic('applications-engineering-symbolic.svg', 'Github')
export const Globe = symbolic('web-browser-symbolic.svg', 'Globe')
export const Inbox = symbolic('mail-inbox-symbolic.svg', 'Inbox')
export const Info = symbolic('dialog-information-symbolic.svg', 'Info')
export const Keyboard = symbolic('input-keyboard-symbolic.svg', 'Keyboard')
export const Layers = symbolic('view-paged-symbolic.svg', 'Layers')
export const Link2 = symbolic('insert-link-symbolic.svg', 'Link2')
export const ListVideo = symbolic('view-list-bullet-symbolic.svg', 'ListVideo')
export const Loader2 = symbolic('process-working-symbolic.svg', 'Loader2')
export const Mail = symbolic('mail-unread-symbolic.svg', 'Mail')
export const Minus = symbolic('list-remove-symbolic.svg', 'Minus')
export const MoreHorizontal = symbolic('view-more-symbolic.svg', 'MoreHorizontal')
export const Pause = symbolic('media-playback-pause-symbolic.svg', 'Pause')
export const Pencil = symbolic('document-edit-symbolic.svg', 'Pencil')
export const Play = symbolic('media-playback-start-symbolic.svg', 'Play')
export const Plus = symbolic('list-add-symbolic.svg', 'Plus')
export const Radar = symbolic('alarm-symbolic.svg', 'Radar')
export const RefreshCw = symbolic('view-refresh-symbolic.svg', 'RefreshCw')
export const RotateCcw = symbolic('edit-undo-symbolic.svg', 'RotateCcw')
export const RotateCw = symbolic('edit-redo-symbolic.svg', 'RotateCw')
export const Scissors = symbolic('edit-cut-symbolic.svg', 'Scissors')
export const Search = symbolic('system-search-symbolic.svg', 'Search')
export const SearchX = symbolic('edit-find-symbolic.svg', 'SearchX')
export const Send = symbolic('mail-send-symbolic.svg', 'Send')
export const Settings = symbolic('emblem-system-symbolic.svg', 'Settings')
export const Square = symbolic('window-maximize-symbolic.svg', 'Square')
export const Terminal = symbolic('utilities-terminal-symbolic.svg', 'Terminal')
export const Trash2 = symbolic('user-trash-symbolic.svg', 'Trash2')
export const Upload = symbolic('document-send-symbolic.svg', 'Upload')
export const X = symbolic('window-close-symbolic.svg', 'X')
export const Languages = symbolic('preferences-desktop-locale-symbolic.svg', 'Languages')
export const SidebarShow = symbolic('sidebar-show-symbolic.svg', 'SidebarShow')
export const OpenMenu = symbolic('open-menu-symbolic.svg', 'OpenMenu')
export const GoNext = symbolic('go-next-symbolic.svg', 'GoNext')
export const GoPrevious = symbolic('go-previous-symbolic.svg', 'GoPrevious')
export const WindowMinimize = symbolic('window-minimize-symbolic.svg', 'WindowMinimize')
export const WindowMaximize = symbolic('window-maximize-symbolic.svg', 'WindowMaximize')
export const WindowRestore = symbolic('window-restore-symbolic.svg', 'WindowRestore')
export const WindowClose = symbolic('window-close-symbolic.svg', 'WindowClose')
export const Appearance = symbolic('preferences-desktop-appearance-symbolic.svg', 'Appearance')
export const Multimedia = symbolic('applications-multimedia-symbolic.svg', 'Multimedia')
export const Alarm = symbolic('alarm-symbolic.svg', 'Alarm')
export const ChannelSecure = symbolic('channel-secure-symbolic.svg', 'ChannelSecure')
export const NetworkWired = symbolic('network-wired-symbolic.svg', 'NetworkWired')
export const Computer = symbolic('computer-symbolic.svg', 'Computer')
export const SystemSearch = symbolic('system-search-symbolic.svg', 'SystemSearch')
export const Clear = symbolic('edit-clear-symbolic.svg', 'Clear')
export const Help = symbolic('help-about-symbolic.svg', 'Help')
export const ProcessStop = symbolic('process-stop-symbolic.svg', 'ProcessStop')
export const Bug = symbolic('dialog-warning-symbolic.svg', 'Bug')
export const Credits = symbolic('emblem-favorite-symbolic.svg', 'Credits')
export const Legal = symbolic('text-x-generic-symbolic.svg', 'Legal')
