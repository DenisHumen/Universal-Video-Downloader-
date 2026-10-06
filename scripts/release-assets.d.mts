// Types for release-assets.mjs, so its tests typecheck with the rest of scripts/.
export declare const PRODUCT: string
export declare const UPDATE_INFO: string[]
export declare const INSTALLER_EXTENSIONS: string[]
export declare function releaseBinaries(version: string): string[]
export declare function installersIn(names: string[]): string[]
export declare function missingAssets(version: string, present: string[]): string[]
export declare function parseUpdateInfo(text: string): {
  fields: Record<string, string>
  files: Array<Record<string, string>>
}
export declare function mergeMacUpdateInfo(x64Text: string, arm64Text: string): string
export declare function updateInfoProblems(
  name: string,
  text: string,
  version: string,
  actual: Map<string, { size: number; sha512: string }>
): string[]
export declare function sha256sums(entries: Array<{ name: string; sha256: string }>): string
