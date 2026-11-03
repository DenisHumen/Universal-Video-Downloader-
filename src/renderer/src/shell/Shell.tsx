import type { ReactNode } from 'react'
import CaptionButtons from '../components/CaptionButtons'
import { useMediaQuery } from '../hooks/useMediaQuery'
import Sidebar from './Sidebar'

interface Props {
  /** From the preload (appInfo.platform), so tests can render the shell as any OS. */
  platform: NodeJS.Platform | undefined
  /** Full-width strips pinned under the sheet's top: engine setup, update, notices. */
  notices?: ReactNode
  children: ReactNode
}

/** Where the sidebar collapses to its icon rail (plan 4.2). */
export const RAIL_BELOW = 1000

/**
 * The 4.0 window (plan 4.2): a sidebar on the canvas and the content in an
 * inset sheet on `--surface` with a 12 px top-left corner (plus a hairline on
 * its top and left edges in Night, where the plane step alone is too faint).
 *
 * Window chrome keeps working on every OS ([v2] SE-1):
 *  - the sheet's 36 px top strip and the sidebar's top are drag regions, and
 *    everything interactive inside them is `no-drag`;
 *  - minimise / maximise / close sit at the sheet's top-right on Windows and
 *    Linux, flush with the window corner;
 *  - on macOS the native traffic lights sit in the sidebar's (empty) top.
 * shell.test.tsx renders this as win32, linux and darwin and checks all three.
 */
export default function Shell({ platform, notices, children }: Props): JSX.Element {
  const wide = useMediaQuery(`(min-width: ${RAIL_BELOW}px)`)
  const isMac = platform === 'darwin'

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar platform={platform} rail={!wide} />
      <div className="app-sheet relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-3 bg-raise">
        <div className="drag-region flex h-9 shrink-0 items-stretch justify-end" data-uvd="sheet-drag">
          {!isMac && <CaptionButtons />}
        </div>
        {notices}
        {children}
      </div>
    </div>
  )
}
