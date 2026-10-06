// Types for electron-fuses.mjs, so its tests typecheck with the rest of scripts/.
export interface FuseWire {
  at: number
  version: number
  length: number
  start: number
}
export declare const SENTINEL: string
export declare const WIRE_VERSION: number
export declare const FUSES: string[]
export declare const SHIPPED_FUSES: Record<string, boolean>
export declare function fuseWires(buf: Buffer): FuseWire[]
export declare function fuseStates(buf: Buffer, wire: FuseWire): Record<string, string>
export declare function fuseProblems(buf: Buffer, wanted?: Record<string, boolean>): string[]
export declare function flipFuses(buf: Buffer, wanted?: Record<string, boolean>): number
export declare function fuseBinaryPath(
  platform: string,
  appOutDir: string,
  names: { productFilename: string; executableName?: string }
): string
