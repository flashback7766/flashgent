import type { FlashgentApi } from '../shared/ipc.js'

declare global {
  interface Window {
    flashgent: FlashgentApi
  }
}

export {}
