// Types for linux-package.mjs, so its tests typecheck with the rest of scripts/.
export declare const HICOLOR_SIZES: number[]
export declare function pngSize(buf: Buffer): { width: number; height: number } | null
export declare function iconProblems(files: Map<string, Buffer>): string[]
export declare function hicolorSizes(paths: string[], iconName: string): number[]
export declare function parseDesktopEntry(text: string): Map<string, string>
export declare function desktopEntryProblems(text: string, executable: string): string[]
export declare function apparmorProfileTarget(text: string): { name: string; attach: string } | null
export declare function profileProblem(text: string, installed: string, executable: string): string | null
export declare const SCRIPT_MACROS: string[]
export declare function unknownMacros(text: string): string[]
export declare function fillMacros(text: string, values: Record<string, string>): string
export declare function packageLayout(paths: string[]): { executable?: string; product?: string }
export declare function layoutProblems(paths: string[]): string[]
export declare function scriptProblems(postinst: string, postrm: string, executable: string): string[]
export declare function rpmScriptlets(text: string): Record<string, string>
