import { createElement, forwardRef } from 'react'
import * as L from 'lucide-react'
import type { LucideIcon, LucideProps } from 'lucide-react'

/**
 * The app's icon set (plan 3.2): lucide, at the 4.0 stroke of 1.75.
 *
 * Everything outside `ui/` imports icons from here, never from lucide-react
 * (ui.test.tsx enforces it), so the stroke, and any future swap of the set,
 * is decided in one place. Each icon is a thin wrapper that defaults
 * `strokeWidth`; a caller may still pass its own. For sizing use `<Icon>`
 * (sm 14 / md 16 / lg 24) or `size`.
 */

export const ICON_STROKE = 1.75

export type { LucideIcon as IconComponent, LucideProps as IconProps }

function stroke(icon: LucideIcon, name: string): LucideIcon {
  const Wrapped = forwardRef<SVGSVGElement, LucideProps>((props, ref) =>
    createElement(icon, { strokeWidth: ICON_STROKE, ...props, ref })
  )
  Wrapped.displayName = name
  return Wrapped as LucideIcon
}

export const AlertCircle = stroke(L.AlertCircle, 'AlertCircle')
export const AlertTriangle = stroke(L.AlertTriangle, 'AlertTriangle')
export const ArrowDownToLine = stroke(L.ArrowDownToLine, 'ArrowDownToLine')
export const ArrowLeft = stroke(L.ArrowLeft, 'ArrowLeft')
export const ArrowRight = stroke(L.ArrowRight, 'ArrowRight')
export const ArrowUp = stroke(L.ArrowUp, 'ArrowUp')
export const ArrowUpRight = stroke(L.ArrowUpRight, 'ArrowUpRight')
export const CalendarClock = stroke(L.CalendarClock, 'CalendarClock')
export const Check = stroke(L.Check, 'Check')
export const CheckCircle2 = stroke(L.CheckCircle2, 'CheckCircle2')
export const ChevronDown = stroke(L.ChevronDown, 'ChevronDown')
export const ChevronLeft = stroke(L.ChevronLeft, 'ChevronLeft')
export const ChevronRight = stroke(L.ChevronRight, 'ChevronRight')
export const CircleX = stroke(L.CircleX, 'CircleX')
export const ClipboardPaste = stroke(L.ClipboardPaste, 'ClipboardPaste')
export const Clock = stroke(L.Clock, 'Clock')
export const Copy = stroke(L.Copy, 'Copy')
export const Crosshair = stroke(L.Crosshair, 'Crosshair')
export const Download = stroke(L.Download, 'Download')
export const ExternalLink = stroke(L.ExternalLink, 'ExternalLink')
export const FileVideo = stroke(L.FileVideo, 'FileVideo')
export const Film = stroke(L.Film, 'Film')
export const Folder = stroke(L.Folder, 'Folder')
export const FolderOpen = stroke(L.FolderOpen, 'FolderOpen')
export const FolderUp = stroke(L.FolderUp, 'FolderUp')
export const Github = stroke(L.Github, 'Github')
export const Globe = stroke(L.Globe, 'Globe')
export const Inbox = stroke(L.Inbox, 'Inbox')
export const Info = stroke(L.Info, 'Info')
export const Keyboard = stroke(L.Keyboard, 'Keyboard')
export const Layers = stroke(L.Layers, 'Layers')
export const Link2 = stroke(L.Link2, 'Link2')
export const ListVideo = stroke(L.ListVideo, 'ListVideo')
export const Loader2 = stroke(L.Loader2, 'Loader2')
export const Mail = stroke(L.Mail, 'Mail')
export const Minus = stroke(L.Minus, 'Minus')
export const MoreHorizontal = stroke(L.MoreHorizontal, 'MoreHorizontal')
export const Pause = stroke(L.Pause, 'Pause')
export const Pencil = stroke(L.Pencil, 'Pencil')
export const Play = stroke(L.Play, 'Play')
export const Plus = stroke(L.Plus, 'Plus')
export const Radar = stroke(L.Radar, 'Radar')
export const RefreshCw = stroke(L.RefreshCw, 'RefreshCw')
export const RotateCcw = stroke(L.RotateCcw, 'RotateCcw')
export const RotateCw = stroke(L.RotateCw, 'RotateCw')
export const Scissors = stroke(L.Scissors, 'Scissors')
export const Search = stroke(L.Search, 'Search')
export const SearchX = stroke(L.SearchX, 'SearchX')
export const Send = stroke(L.Send, 'Send')
export const Settings = stroke(L.Settings, 'Settings')
export const Square = stroke(L.Square, 'Square')
export const Terminal = stroke(L.Terminal, 'Terminal')
export const Trash2 = stroke(L.Trash2, 'Trash2')
export const Upload = stroke(L.Upload, 'Upload')
export const X = stroke(L.X, 'X')
export const Languages = stroke(L.Languages, 'Languages')
