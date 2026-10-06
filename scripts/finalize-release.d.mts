// Types for finalize-release.mjs, so its tests typecheck with the rest of scripts/.
export declare function finalizeRelease(options: {
  version: string
  assetsDir: string
  macDir: string
}): Promise<{ installers: string[]; warnings: string[] }>

/** The latest-mac.yml one Mac runner kept, found at any depth under its artifact folder. */
export declare function runnerCopy(macDir: string, runner: string): string
