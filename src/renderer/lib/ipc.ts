import type { IpcResult } from '@shared/types'

/** Throw on the failure branch so callers can use ordinary try/catch. */
export function must<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Return a fallback instead of throwing, for non-critical reads. */
export function orElse<T>(result: IpcResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}

export const api = (): Window['flashgent'] => window.flashgent
