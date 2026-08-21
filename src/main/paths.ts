import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `~/.flashgent` — user-editable config and secrets live here.
 * FLASHGENT_HOME redirects it, which keeps e2e runs and portable installs
 * from touching the real configuration.
 */
export const HOME_DIR = process.env.FLASHGENT_HOME ?? join(homedir(), '.flashgent')
export const CONFIG_FILE = join(HOME_DIR, 'config.json')
export const ENV_FILE = join(HOME_DIR, '.env')
export const SNIPPETS_DIR = join(HOME_DIR, 'snippets')

/** OS-standard app data — database, logs and backups live here. */
export function userDataDir(): string {
  return app.getPath('userData')
}
export function dbFile(): string {
  return join(userDataDir(), 'flashgent.db')
}
export function backupDir(): string {
  return join(userDataDir(), 'backups')
}
export function logDir(): string {
  return join(userDataDir(), 'logs')
}
export function migrationsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(app.getAppPath(), 'src/main/db/migrations')
}

export function ensureDirs(): void {
  for (const dir of [HOME_DIR, SNIPPETS_DIR, userDataDir(), backupDir(), logDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * Minimal .env loader. Secrets stay in the main process; the renderer only
 * ever sees them indirectly, through requests main makes on its behalf.
 */
export function loadEnvFile(): void {
  for (const file of [ENV_FILE, join(process.cwd(), '.env')]) {
    if (!existsSync(file)) continue
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      // Real environment variables win over the file.
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  }
}

export const isDebug = (): boolean => process.env.DEBUG === '1' || process.env.DEBUG === 'true'
