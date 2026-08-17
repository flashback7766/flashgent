import { BrowserWindow, app } from 'electron'
import electronUpdater from 'electron-updater'
import { CH } from '../../shared/ipc.js'
import type { UpdateInfo, UpdateProgress } from '../../shared/types.js'
import { logger } from '../logger.js'
import { handle } from './result.js'

const getAutoUpdater = () => electronUpdater.autoUpdater

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

let latestUpdate: UpdateInfo | null = null

interface ParsedVersion {
  core: number[]
  prerelease: string[]
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  const core = match?.[1]
  if (!core) return null
  return {
    core: core.split('.').map(Number),
    prerelease: match[2] ? match[2].split('.') : []
  }
}

/** True only when candidate is strictly newer according to SemVer precedence. */
function isVersionNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  // electron-updater normally supplies SemVer. If a publisher sends an invalid
  // version, avoid advertising an update based on a string comparison.
  if (!next || !installed) return false

  const length = Math.max(next.core.length, installed.core.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (next.core[index] ?? 0) - (installed.core[index] ?? 0)
    if (delta !== 0) return delta > 0
  }

  if (next.prerelease.length === 0 || installed.prerelease.length === 0) {
    return next.prerelease.length === 0 && installed.prerelease.length > 0
  }

  const prereleaseLength = Math.max(next.prerelease.length, installed.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const a = next.prerelease[index]
    const b = installed.prerelease[index]
    if (a === undefined || b === undefined) return a !== undefined
    if (a === b) continue
    const aNumber = /^\d+$/.test(a)
    const bNumber = /^\d+$/.test(b)
    if (aNumber && bNumber) return Number(a) > Number(b)
    if (aNumber !== bNumber) return !aNumber
    return a > b
  }
  return false
}

export function initUpdater(): void {
  const autoUpdater = getAutoUpdater()

  // Configure autoUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = {
    info(msg: string) {
      logger.info(`[updater] ${msg}`)
    },
    warn(msg: string) {
      logger.warn(`[updater] ${msg}`)
    },
    error(msg: string) {
      logger.error(`[updater] ${msg}`)
    },
    debug(msg: string) {
      logger.debug(`[updater] ${msg}`)
    }
  }

  autoUpdater.on('update-available', (info) => {
    logger.info(`update available: v${info.version}`)
    latestUpdate = {
      available: true,
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      downloaded: false
    }
    broadcast(CH.evtUpdateAvailable, latestUpdate)
  })

  autoUpdater.on('update-not-available', (info) => {
    logger.info(`no update available. current: v${app.getVersion()}, latest: v${info.version}`)
    latestUpdate = {
      available: false,
      version: info.version
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    const p: UpdateProgress = {
      percent: Math.round(progress.percent * 10) / 10,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    }
    broadcast(CH.evtUpdateProgress, p)
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`update downloaded: v${info.version}`)
    latestUpdate = {
      available: true,
      version: info.version,
      releaseDate: info.releaseDate,
      downloaded: true
    }
    broadcast(CH.evtUpdateDownloaded, latestUpdate)
  })

  autoUpdater.on('error', (err) => {
    logger.warn('[updater] check/download failed', err.message)
    latestUpdate = {
      available: false,
      error: err.message
    }
  })
}

export function registerUpdaterHandlers(): void {
  const autoUpdater = getAutoUpdater()

  handle<void, UpdateInfo>(CH.updaterCheck, async () => {
    if (!app.isPackaged) {
      return {
        available: false,
        version: app.getVersion(),
        releaseNotes: 'Running in development mode (updates disabled in dev).'
      }
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      if (result && result.updateInfo) {
        const isNewer = isVersionNewer(result.updateInfo.version, app.getVersion())
        latestUpdate = {
          available: isNewer,
          version: result.updateInfo.version,
          releaseDate: result.updateInfo.releaseDate,
          releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
          downloaded: false
        }
        return latestUpdate
      }
      return latestUpdate ?? { available: false, version: app.getVersion() }
    } catch (err) {
      logger.warn('[updater] check error', err instanceof Error ? err.message : String(err))
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  handle<void, boolean>(CH.updaterDownload, async () => {
    if (!app.isPackaged) {
      throw new Error('Updater is disabled in development mode.')
    }
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch (err) {
      throw new Error(`Failed to download update: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  handle<void, boolean>(CH.updaterInstall, async () => {
    if (!app.isPackaged) {
      throw new Error('Updater is disabled in development mode.')
    }
    // quitAndInstall(isSilent = false, isForceRunAfter = true)
    // Full user data in %APPDATA%\flashgent and ~/.flashgent is preserved.
    autoUpdater.quitAndInstall(false, true)
    return true
  })
}
