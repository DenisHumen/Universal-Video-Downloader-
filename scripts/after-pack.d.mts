// Types for after-pack.mjs, so its tests typecheck with the rest of scripts/.
// Only the part of electron-builder's AfterPackContext the hook reads.
export interface AfterPackContext {
  appOutDir: string
  electronPlatformName: string
  arch: number
  packager: {
    appInfo: { productFilename: string; sanitizedProductName?: string }
    executableName?: string
    buildResourcesDir?: string
  }
}
// The machine doing the packing; electron-builder never passes it.
export interface AfterPackHost {
  platform?: string
  run?: (command: string, args: string[], options?: object) => unknown
  env?: Record<string, string | undefined>
}
export default function afterPack(context: AfterPackContext, host?: AfterPackHost): Promise<void>
