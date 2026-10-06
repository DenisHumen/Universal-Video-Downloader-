// Types for ffmpeg-pins.mjs, so its tests typecheck with the rest of scripts/.
export interface Pin {
  url: string
  sha256: string
  extract?: 'tar.xz'
  member: string
  readme?: string
  licence?: string
  bin: string
  builder: string
  buildScripts: string
  source: string
  sourceArchive: string
}
export interface BundledFfmpeg {
  name: string
  binary: Buffer
  readme: string | null
  licence: string | null
}
export declare const VERSION: string
export declare const NONFREE_MARKER: string
export declare const REQUIRED_LIBRARIES: string[]
export declare const PINNED: Record<string, Pin>
export declare function isNonfree(binary: Buffer): boolean
export declare function missingLibraries(binary: Buffer): string[]
export declare function bannerMatches(banner: string, version?: string): boolean
export declare function tarArgs(archive: string, members: string[]): string[]
export declare function ffmpegReadme(target: string, pin: Pin, body?: string): string
export declare function noticeProblems(files: BundledFfmpeg, version?: string): string[]
export declare function thirdPartyProblems(
  text: string,
  version?: string,
  pins?: Record<string, Pin>
): string[]
export declare const LINUX_NOTICE_PATHS: string[]
export declare function missingNotices(paths: string[]): string[]
