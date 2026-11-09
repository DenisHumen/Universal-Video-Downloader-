import { existsSync } from 'fs'
import { dialog, BrowserWindow } from 'electron'
import { guardedIpc as ipcMain } from './services/ipc-guard'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import { describeSeries } from './services/automation/detect'
import {
  addWatch,
  getWatch,
  listRuns,
  listWatches,
  removeWatch,
  updateWatch,
  watchEvents
} from './services/automation/store'
import { rescheduledCheck } from './services/automation/backoff'
import { checkNow, retryRun } from './services/automation/watcher'
import { stopEpisode } from './services/automation/pipeline'
import { createSmbFolder, listSmbFolders, testTarget } from './services/automation/smb'
import { shareForFolder } from './services/automation/share-folder'
import { sendTest } from './services/automation/telegram'
import { currentLanguage } from './services/locale'
import { getSecretWhenReady, hasSecret, SECRET, secretsPersist, setSecret } from './services/secrets'
import { log, logFilePath } from './services/log'
import { getSettings } from './services/settings'
import { coalesce } from './services/coalesce'
import { getDownload, relocateItem } from './services/downloader'
import { entryFile, followEntry } from './services/library'
import { cleanShareRequest, sendToShare } from './services/share-send'
import { fromRenderer } from './services/navigation'
import type { ShareSendResult } from '@shared/types'
import {
  duplicateAfterEdit,
  exactDuplicate,
  formatSmbPath,
  inheritedSeen,
  normaliseSmbTarget,
  settleRunError,
  settleTokenSaved,
  type AddedWatch,
  type CheckSummary,
  type EpisodeRef,
  type RetryAnswer,
  type Run,
  type ShareFolderPick,
  type SmbTarget,
  type Watch
} from '@shared/automation'

/**
 * The automation's side of the bridge.
 *
 * In its own file rather than in `ipc.ts` because it is a dozen channels that
 * belong together, and because one rule applies to all of them: a secret never
 * travels back. The renderer may set a password and may ask whether one is
 * stored; it may not read one. The proxy's password goes through the same two
 * channels, so there is one place that rule is kept.
 */

/** What the "add a watch" screen can be given, with nothing unserialisable. */
export interface SeriesOffer {
  url: string
  title: string
  thumbnail?: string
  provider: string
  defaultTranslator: string
  qualities: string[]
  /**
   * Each dub with the episodes *it* has, which is what a watch follows.
   *
   * The list itself travels, not only its length, so a watch told to leave the
   * back catalogue alone can mark exactly what was out when it was added -
   * without a second look at the site, which costs three more requests and may
   * not answer the same way a minute later.
   */
  translators: { id: string; name: string; premium?: boolean; episodes: number; list: EpisodeRef[] }[]
  /** Nothing is out yet. There are no dubs to list, only the date the site expects. */
  upcoming?: { releaseAt?: number }
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.evtAutoChanged)
  }
}

/**
 * Which server may be sent which password, for the buttons that try a share.
 *
 * A password typed in the form goes where the form says. The stored one goes only
 * to the server it was stored for: the window names the target, and "this id, on
 * that host" handed the saved password to whatever host it named. Everything else
 * in the form stays as typed, so a changed folder can be tried before it is saved.
 */
async function shareLogin(target: SmbTarget, password: string): Promise<{ to: SmbTarget; secret: string }> {
  if (password) return { to: target, secret: password }
  const stored = getSettings().smbTargets.find((t) => t.id === target?.id)
  if (!stored) return { to: target, secret: '' }
  const server = (t: SmbTarget): string => normaliseSmbTarget(t).host.toLowerCase()
  if (server(target) !== server(stored)) {
    throw new Error('Enter the password again to use it with another server.')
  }
  return { to: { ...target, host: stored.host }, secret: (await getSecretWhenReady(SECRET.smbPassword(stored.id))) ?? '' }
}

export function registerAutomationIpc(): void {
  /*
    Everything the schedule writes reaches the screen through here: checks, runs
    moving through their steps, an episode marked handled. Folded so a run that
    steps along quickly costs one refetch rather than one per step. The handlers
    below still broadcast straight away, so a button press is not kept waiting
    for the window; the duplicate that follows is harmless.
  */
  watchEvents.on('changed', coalesce(broadcast, 300))

  ipcMain.handle(IPC.autoDescribe, async (_e, url: string): Promise<SeriesOffer> => {
    const d = await describeSeries(url)
    return {
      url: d.url,
      title: d.title,
      thumbnail: d.thumbnail,
      provider: d.provider,
      defaultTranslator: d.defaultTranslator,
      qualities: d.qualities,
      translators: d.translators.map((t) => {
        const list = d.episodesFor(t.id)
        return { ...t, episodes: list.length, list }
      }),
      upcoming: d.upcoming
    }
  })

  ipcMain.handle(IPC.autoList, (): Watch[] => listWatches())
  ipcMain.handle(IPC.autoRuns, (_e, watchId: string): Run[] => listRuns(watchId))

  /*
    An exact copy of a watch that exists is refused, quietly: the screen is
    handed that watch to show instead. Anything short of exact - another
    quality, another share - is somebody's deliberate choice, and goes in,
    having already seen what its elder sibling handled.
  */
  ipcMain.handle(IPC.autoAdd, (_e, watch: Omit<Watch, 'id' | 'createdAt'>): AddedWatch => {
    const watches = listWatches()
    const existing = exactDuplicate(watches, watch)
    if (existing) return { ...existing, existing: true }
    const created = addWatch({
      ...watch,
      seen: inheritedSeen(watches, watch),
      id: randomUUID(),
      createdAt: Date.now(),
      // Due straight away, so adding a series does something visible.
      nextCheckAt: Date.now()
    })
    broadcast()
    return created
  })

  ipcMain.handle(IPC.autoUpdate, (_e, id: string, patch: Partial<Watch>): Watch | undefined => {
    // The screen says why before it gets here; this is the half that holds. Answered with the watch as it stands.
    if (duplicateAfterEdit(listWatches(), id, patch)) return getWatch(id)
    // A tighter interval takes effect now, rather than after the check it was meant to bring forward.
    const current = getWatch(id)
    const sooner =
      current && patch.intervalMinutes !== undefined && patch.nextCheckAt === undefined
        ? rescheduledCheck(current, patch.intervalMinutes, Date.now())
        : undefined
    const next = updateWatch(
      id,
      settleRunError(sooner === undefined ? patch : { ...patch, nextCheckAt: sooner })
    )
    // Pausing stops the episode downloading now too, not only the ones after it; resuming fetches it again.
    if (patch.enabled === false) stopEpisode(id, 'paused')
    broadcast()
    return next
  })

  /*
    The episode downloading for it is stopped first. Left running, it went on
    to be uploaded and announced for a series nobody was watching any more.
  */
  ipcMain.handle(IPC.autoRemove, (_e, id: string): void => {
    stopEpisode(id, 'removed')
    removeWatch(id)
    broadcast()
  })

  /*
    Answers once the page has been read. Episodes it found carry on through the
    chain afterwards, and reach the screen through the store's own broadcasts.
  */
  ipcMain.handle(IPC.autoCheckNow, async (_e, id: string): Promise<CheckSummary> => {
    const summary = await checkNow(id)
    broadcast()
    return summary
  })

  // Answers once the episode is on its way; the run reaches the screen like any other.
  ipcMain.handle(IPC.autoRetryRun, (_e, runId: string): RetryAnswer => {
    const answer = retryRun(runId)
    broadcast()
    return answer
  })

  /*
    The test buttons take the password as an argument rather than reading the
    stored one, so somebody can check a password before committing to it — and
    so the flow is the same whether or not one has been saved yet.
  */
  ipcMain.handle(
    IPC.autoTestSmb,
    async (_e, target: SmbTarget, password: string): Promise<string> => {
      const { to, secret } = await shareLogin(target, password)
      return testTarget(to, secret)
    }
  )

  /*
    The in-app folder browser, for a share the OS has not mounted. Same
    password rule as the test: the one being typed, else the one stored.
  */
  ipcMain.handle(
    IPC.autoListShareFolders,
    async (_e, target: SmbTarget, password: string, folder: string): Promise<string[]> => {
      const { to, secret } = await shareLogin(target, password)
      return listSmbFolders(to, secret, String(folder ?? ''))
    }
  )

  /*
    "Send to Share…". The window names a row and is never believed about which
    file that is, or this would be a way to send any file on the machine to any
    share it knows. Asking about progress several times a second is plenty: the
    upload reports per chunk, and a big file has tens of thousands of those.
  */
  ipcMain.handle(IPC.shareSend, async (event, raw: unknown): Promise<ShareSendResult> => {
    // A page in the built-in browser has no business sending the user's files anywhere.
    if (!fromRenderer(event)) {
      log.warn('app', 'Refused a call from a page that is not the app', { channel: IPC.shareSend })
      throw new Error(`${IPC.shareSend} is only available to the app itself`)
    }
    const request = cleanShareRequest(raw)
    if (!request) return { status: 'failed', kind: 'path', message: 'That is not a folder on the share.' }
    const file = getDownload(request.id)?.filepath ?? entryFile(request.id)
    if (!file || !existsSync(file)) {
      return { status: 'failed', kind: 'noFile', message: 'The file is no longer on this computer.' }
    }
    let lastSent = 0
    const result = await sendToShare(request, file, getSettings().smbTargets, (bytes, total) => {
      const now = Date.now()
      if (bytes < total && now - lastSent < 250) return
      lastSent = now
      if (!event.sender.isDestroyed()) event.sender.send(IPC.evtShareSendProgress, { id: request.id, bytes, total })
    })
    if (result.status === 'sent') {
      // The row if it is still in the queue, the entry whichever: either may be all that is left.
      relocateItem(request.id, { remotePath: result.remotePath })
      followEntry(request.id, { remotePath: result.remotePath })
    }
    return result
  })

  ipcMain.handle(
    IPC.autoCreateShareFolder,
    async (_e, target: SmbTarget, password: string, parent: string, name: string): Promise<string> => {
      const { to, secret } = await shareLogin(target, password)
      return createSmbFolder(to, secret, String(parent ?? ''), String(name ?? ''))
    }
  )

  /*
    No typing the path: the system dialog already browses the network, and the
    folder it answers with is on a share the OS has mounted somewhere. Start it
    where those mounts are, so the shares are the first thing on screen.
  */
  ipcMain.handle(
    IPC.autoChooseShareFolder,
    async (event, current: SmbTarget, title: string): Promise<ShareFolderPick> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const target = normaliseSmbTarget(current)
      const unc = formatSmbPath({ host: target.host, share: target.share, folder: target.path ?? '' })
      const start =
        process.platform === 'win32'
          ? unc || undefined
          : process.platform === 'darwin'
            ? '/Volumes'
            : [`/run/user/${process.getuid?.() ?? 1000}/gvfs`].find((p) => existsSync(p))
      const options: Electron.OpenDialogOptions = {
        title: String(title || ''),
        defaultPath: start,
        properties: ['openDirectory', 'createDirectory']
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths.length) return null
      const picked = result.filePaths[0]
      const location = await shareForFolder(picked)
      return location ? { location } : { local: picked }
    }
  )

  ipcMain.handle(
    IPC.autoTestTelegram,
    async (_e, token: string, chatId: string): Promise<string> => {
      const secret = token || (await getSecretWhenReady(SECRET.telegramToken())) || ''
      return sendTest(secret, chatId || getSettings().telegramChatId, currentLanguage())
    }
  )

  /** One way only. There is deliberately no channel that returns a secret. */
  ipcMain.handle(
    IPC.autoSetSecret,
    async (_e, kind: 'smb' | 'telegram' | 'proxy', id: string, value: string) => {
      /*
        A new proxy password needs nothing more: Chromium caches only
        credentials that worked, and asks again - reading the new one - once
        they stop working. Clearing its auth cache here froze the app after a
        refused password.
      */
      const key =
        kind === 'smb'
          ? SECRET.smbPassword(id)
          : kind === 'proxy'
            ? SECRET.proxyPassword()
            : SECRET.telegramToken()
      // Answers once it is on disk, so a quit right after cannot lose it; false when it is not.
      const saved = await setSecret(key, value)
      if (kind === 'telegram') {
        if (saved && value) {
          for (const watch of listWatches()) {
            const patch = settleTokenSaved(watch)
            if (patch) updateWatch(watch.id, patch)
          }
        }
        // The Telegram step's line on the screen depends on whether a token is there.
        broadcast()
      }
      return saved
    }
  )

  ipcMain.handle(
    IPC.autoSecretState,
    (): { telegram: boolean; smb: Record<string, boolean>; proxy: boolean; persists: boolean } => ({
      telegram: hasSecret(SECRET.telegramToken()),
      proxy: hasSecret(SECRET.proxyPassword()),
      smb: Object.fromEntries(
        getSettings().smbTargets.map((t) => [t.id, hasSecret(SECRET.smbPassword(t.id))])
      ),
      persists: secretsPersist()
    })
  )

  ipcMain.handle(IPC.logPath, (): string => logFilePath())
}
