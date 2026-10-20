import { app } from 'electron'
import { join } from 'path'
import { InfoCache } from './info-cache'

/**
 * The one cache of probe JSON the detector fills and the downloader drains.
 * Its folder is asked for only when something is written, so importing this
 * costs nothing where Electron is not running.
 */
export const infoCache = new InfoCache(() => join(app.getPath('userData'), 'info-cache'))

/*
  Files past their fifteen minutes go even when nothing else touches the
  cache. Unref'd: this must never be what keeps the process alive.
*/
setInterval(() => infoCache.sweep(), 5 * 60_000).unref?.()
