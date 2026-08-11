import { ipcMain } from 'electron'
import type { IpcResult } from '../../shared/types.js'
import { logger } from '../logger.js'

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Register a handler for a channel taking a single request object. Anything
 * thrown is converted into `{ ok: false, error }` so the renderer never has to
 * deal with a rejected invoke.
 */
export function handle<Req, Res>(
  channel: string,
  fn: (req: Req) => Promise<Res> | Res
): void {
  ipcMain.handle(channel, async (_event, req: Req): Promise<IpcResult<Res>> => {
    try {
      return { ok: true, value: await fn(req) }
    } catch (err) {
      logger.error(`ipc ${channel} failed`, toMessage(err))
      return { ok: false, error: toMessage(err) }
    }
  })
}

/** Same contract, for channels that take more than one positional argument. */
export function handleN<Res>(
  channel: string,
  fn: (...args: never[]) => Promise<Res> | Res
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<Res>> => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => Promise<Res> | Res)(...args) }
    } catch (err) {
      logger.error(`ipc ${channel} failed`, toMessage(err))
      return { ok: false, error: toMessage(err) }
    }
  })
}
