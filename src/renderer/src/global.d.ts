import type { UvdApi } from '../../preload/index'

declare global {
  interface Window {
    api: UvdApi
  }
}

export {}
