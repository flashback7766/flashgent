import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mergeConfig } from '../shared/config.js'
import type { AppConfig } from '../shared/types.js'
import { logger } from './logger.js'
import { CONFIG_FILE } from './paths.js'

let cached: AppConfig | null = null

export function readConfig(): AppConfig {
  if (cached) return cached

  let parsed: unknown = null
  if (existsSync(CONFIG_FILE)) {
    try {
      parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    } catch (err) {
      logger.warn('config.json is unreadable, falling back to defaults', String(err))
    }
  }

  cached = mergeConfig(parsed)

  // An env var beats the stored endpoint so a machine can be pointed elsewhere
  // without editing config.
  const envUrl = process.env.LMSTUDIO_BASE_URL
  if (envUrl) {
    const active = cached.endpoints.find((e) => e.id === cached!.activeEndpointId)
    if (active) active.baseUrl = envUrl
  }

  if (!existsSync(CONFIG_FILE)) writeConfig(cached)
  return cached
}

export function writeConfig(config: AppConfig): AppConfig {
  cached = mergeConfig(config)
  try {
    writeFileSync(CONFIG_FILE, `${JSON.stringify(cached, null, 2)}\n`, 'utf8')
  } catch (err) {
    logger.error('failed to persist config.json', String(err))
  }
  return cached
}

/** Endpoint the renderer should currently be talking to. */
export function activeBaseUrl(): string {
  const cfg = readConfig()
  return cfg.endpoints.find((e) => e.id === cfg.activeEndpointId)?.baseUrl ?? 'http://localhost:1234/v1'
}
