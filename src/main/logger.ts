import { appendFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { isDebug, logDir } from './paths.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const RETENTION_DAYS = 7

let minLevel: LogLevel = 'info'
let currentFile = ''

function fileForToday(): string {
  const day = new Date().toISOString().slice(0, 10)
  return join(logDir(), `app-${day}.log`)
}

/** Drop log files older than the retention window. */
function prune(): void {
  const dir = logDir()
  if (!existsSync(dir)) return
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('app-') || !name.endsWith('.log')) continue
    const full = join(dir, name)
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    } catch {
      // A locked or already-removed file is not worth failing startup over.
    }
  }
}

export function initLogger(): void {
  minLevel = isDebug() ? 'debug' : 'info'
  currentFile = fileForToday()
  prune()
  log('info', `flashgent starting (level=${minLevel})`)
}

export function log(level: LogLevel, message: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return

  const stamp = new Date().toISOString()
  const extra = meta === undefined ? '' : ` ${safeStringify(meta)}`
  const line = `${stamp} [${level.toUpperCase()}] ${message}${extra}\n`

  if (level === 'error') process.stderr.write(line)
  else if (isDebug()) process.stdout.write(line)

  // The file name rolls at midnight without needing a timer.
  const target = fileForToday()
  if (target !== currentFile) {
    currentFile = target
    prune()
  }
  try {
    appendFileSync(currentFile, line, 'utf8')
  } catch {
    // Never let logging take the app down.
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = {
  debug: (m: string, meta?: unknown) => log('debug', m, meta),
  info: (m: string, meta?: unknown) => log('info', m, meta),
  warn: (m: string, meta?: unknown) => log('warn', m, meta),
  error: (m: string, meta?: unknown) => log('error', m, meta)
}
