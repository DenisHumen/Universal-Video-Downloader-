import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import { describeSeries } from './services/automation/detect'
import {
  addWatch,
  listRuns,
  listWatches,
  removeWatch,
  updateWatch
} from './services/automation/store'
import { checkNow } from './services/automation/watcher'
import { testTarget } from './services/automation/smb'
import { sendTest } from './services/automation/telegram'
import { getSecret, hasSecret, SECRET, secretsPersist, setSecret } from './services/secrets'
import { logFilePath } from './services/log'
import { getSettings } from './services/settings'
import type { Run, SmbTarget, Watch } from '@shared/automation'

/**
 * The automation's side of the bridge.
 *
 * In its own file rather than in `ipc.ts` because it is a dozen channels that
 * belong together, and because one rule applies to all of them: a secret never
 * travels back. The renderer may set a password and may ask whether one is
 * stored; it may not read one.
 */

/** What the "add a watch" screen can be given, with nothing unserialisable. */
export interface SeriesOffer {
  url: string
  title: string
  thumbnail?: string
  provider: string
  defaultTranslator: string
  qualities: string[]
  /** Each dub with the number of episodes *it* has, which is what a watch follows. */
  translators: { id: string; name: string; premium?: boolean; episodes: number }[]
  /** Nothing is out yet. There are no dubs to list, only the date the site expects. */
  upcoming?: { releaseAt?: number }
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.evtAutoChanged)
  }
}

export function registerAutomationIpc(): void {
  ipcMain.handle(IPC.autoDescribe, async (_e, url: string): Promise<SeriesOffer> => {
    const d = await describeSeries(url)
    return {
      url: d.url,
      title: d.title,
      thumbnail: d.thumbnail,
      provider: d.provider,
      defaultTranslator: d.defaultTranslator,
      qualities: d.qualities,
      translators: d.translators.map((t) => ({ ...t, episodes: d.episodesFor(t.id).length })),
      upcoming: d.upcoming
    }
  })

  ipcMain.handle(IPC.autoList, (): Watch[] => listWatches())
  ipcMain.handle(IPC.autoRuns, (_e, watchId: string): Run[] => listRuns(watchId))

  ipcMain.handle(IPC.autoAdd, (_e, watch: Omit<Watch, 'id' | 'createdAt'>): Watch => {
    const created = addWatch({
      ...watch,
      id: randomUUID(),
      createdAt: Date.now(),
      // Due straight away, so adding a series does something visible.
      nextCheckAt: Date.now()
    })
    broadcast()
    return created
  })

  ipcMain.handle(IPC.autoUpdate, (_e, id: string, patch: Partial<Watch>): Watch | undefined => {
    const next = updateWatch(id, patch)
    broadcast()
    return next
  })

  ipcMain.handle(IPC.autoRemove, (_e, id: string): void => {
    removeWatch(id)
    broadcast()
  })

  ipcMain.handle(IPC.autoCheckNow, async (_e, id: string): Promise<void> => {
    await checkNow(id)
    broadcast()
  })

  /*
    The test buttons take the password as an argument rather than reading the
    stored one, so somebody can check a password before committing to it — and
    so the flow is the same whether or not one has been saved yet.
  */
  ipcMain.handle(
    IPC.autoTestSmb,
    async (_e, target: SmbTarget, password: string): Promise<string> => {
      const secret = password || getSecret(SECRET.smbPassword(target.id)) || ''
      return testTarget(target, secret)
    }
  )

  ipcMain.handle(
    IPC.autoTestTelegram,
    async (_e, token: string, chatId: string): Promise<string> => {
      const secret = token || getSecret(SECRET.telegramToken()) || ''
      return sendTest(secret, chatId || getSettings().telegramChatId)
    }
  )

  /** One way only. There is deliberately no channel that returns a secret. */
  ipcMain.handle(IPC.autoSetSecret, (_e, kind: 'smb' | 'telegram', id: string, value: string) => {
    setSecret(kind === 'smb' ? SECRET.smbPassword(id) : SECRET.telegramToken(), value)
  })

  ipcMain.handle(
    IPC.autoSecretState,
    (): { telegram: boolean; smb: Record<string, boolean>; persists: boolean } => ({
      telegram: hasSecret(SECRET.telegramToken()),
      smb: Object.fromEntries(
        getSettings().smbTargets.map((t) => [t.id, hasSecret(SECRET.smbPassword(t.id))])
      ),
      persists: secretsPersist()
    })
  )

  ipcMain.handle(IPC.logPath, (): string => logFilePath())
}
