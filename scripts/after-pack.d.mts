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
export default function afterPack(context: AfterPackContext): Promise<void>
