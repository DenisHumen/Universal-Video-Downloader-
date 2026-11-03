import type { DownloadItem } from '@shared/types'

/*
  6.4: what a finished or failed download's notification offers, per OS
  ([v2] SE-3):

  - macOS: `Notification.actions` - Play and Show in Folder when it is done,
    Fix when it failed.
  - Windows: click-to-open. Buttons need `toastXml` actions, and Electron
    hands an action back to the app only through protocol activation (a URL
    scheme the app would have to register and parse as untrusted input on
    every launch). Not worth that attack surface for a convenience; a click
    does the useful thing instead.
  - Linux: no actions (libnotify servers differ in whether they draw them).

  Everywhere, a click on the notification focuses the app on that row.
*/

export type NotifyAction = 'play' | 'showInFolder' | 'fix'

export interface NotifyPlan {
  title: 'notify.done' | 'notify.failed'
  /** Buttons, in order; Electron reports the index of the one pressed. */
  actions: NotifyAction[]
}

export function planNotification(platform: NodeJS.Platform, item: Pick<DownloadItem, 'state' | 'filepath'>): NotifyPlan {
  const done = item.state === 'completed'
  const title = done ? 'notify.done' : 'notify.failed'
  if (platform !== 'darwin') return { title, actions: [] }
  if (done) return { title, actions: item.filepath ? ['play', 'showInFolder'] : [] }
  return { title, actions: ['fix'] }
}

export const ACTION_LABEL: Record<NotifyAction, 'notify.play' | 'notify.showInFolder' | 'notify.fix'> = {
  play: 'notify.play',
  showInFolder: 'notify.showInFolder',
  fix: 'notify.fix'
}
