// Types for package-extension.mjs, so its tests typecheck with the rest of scripts/.
export declare const ALLOWED_PERMISSIONS: string[]
export declare function extensionProblems(files: Map<string, Buffer>): string[]
export declare function manifestFor(manifest: Record<string, unknown>, browser: 'chromium' | 'firefox'): Record<string, unknown> & {
  background: { scripts?: string[]; service_worker?: string }
}
export declare function zip(files: Map<string, Buffer>): Buffer
export declare function readExtension(dir: string): Map<string, Buffer>
