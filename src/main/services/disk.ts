import { statfs } from 'fs/promises'
import { dirname } from 'path'
import type { FreeSpace } from '@shared/disk'

type StatFs = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>

/** A path the OS hands to the network. A drive letter mapped to a share cannot be told from here. */
const NETWORK_PATH = /^(?:\\\\|\/\/)/

/**
 * How much room there is where a download would land, or nothing if that cannot be said.
 *
 * The folder need not exist yet, since a download makes its own per-site one, so
 * the nearest parent that does stands in: same disk. Anything but "no such folder"
 * is an answer of "don't know". A share that reports no blocks at all is talking
 * nonsense, and a missing answer never stops anybody.
 */
export async function freeSpace(dir: string, read: StatFs = statfs): Promise<FreeSpace | undefined> {
  if (!dir) return undefined
  let at = dir
  for (let hops = 0; hops < 64; hops++) {
    try {
      const s = await read(at)
      if (!(s.bsize > 0) || !(s.blocks > 0) || !(s.bavail >= 0)) return undefined
      return { bytes: s.bavail * s.bsize, reliable: !NETWORK_PATH.test(dir) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      const up = dirname(at)
      if (up === at) return undefined
      at = up
    }
  }
  return undefined
}
