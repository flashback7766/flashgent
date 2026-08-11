import { app, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CH, type AppInfo, type ExportRequest } from '../../shared/ipc.js'
import type { AppConfig, ContentBlock, Message } from '../../shared/types.js'
import { readConfig, writeConfig } from '../configStore.js'
import * as store from '../db/index.js'
import { log, logger } from '../logger.js'
import { CONFIG_FILE, HOME_DIR, isDebug, logDir, userDataDir } from '../paths.js'
import { connectEnabledServers, disconnectAll } from './mcp.js'
import { handle } from './result.js'

/**
 * Workspace requested at launch. Held here until the renderer asks for it in
 * `app:info`, because a push on `did-finish-load` can land before React has
 * mounted and subscribed.
 */
let initialWorkspace: string | null = null

export function setInitialWorkspace(path: string | null): void {
  initialWorkspace = path
}

/** Read once; a later reload should not reopen the same directory again. */
function takeInitialWorkspace(): string | null {
  const path = initialWorkspace
  initialWorkspace = null
  return path
}

export function registerAppHandlers(): void {
  handle<void, AppConfig>(CH.configGet, () => readConfig())

  handle<AppConfig, AppConfig>(CH.configSet, async (next) => {
    const previous = readConfig()
    const saved = writeConfig(next)

    // Reconnect MCP if the server list changed, so the UI reflects reality
    // without needing a restart.
    if (JSON.stringify(previous.mcpServers) !== JSON.stringify(saved.mcpServers)) {
      await disconnectAll()
      void connectEnabledServers()
    }
    return saved
  })

  handle<void, string>(CH.configPath, () => CONFIG_FILE)

  handle<void, AppInfo>(CH.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    platform: process.platform,
    userDataPath: userDataDir(),
    configPath: CONFIG_FILE,
    logPath: logDir(),
    debug: isDebug(),
    homeDir: HOME_DIR,
    initialWorkspace: takeInitialWorkspace()
  }))

  ipcMain.on(CH.appLog, (_e, level: 'info' | 'warn' | 'error' | 'debug', message: string) => {
    log(level, `[renderer] ${message}`)
  })

  handle<ExportRequest, string | null>(CH.appExport, async (req) => {
    const session = store.listSessions().find((s) => s.id === req.sessionId)
    if (!session) throw new Error('Session not found.')

    const messages = store.listMessages(req.sessionId)
    const safeTitle = session.title.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'session'
    const defaultPath = join(app.getPath('downloads'), `${safeTitle}.${req.format}`)

    const result = await dialog.showSaveDialog({
      title: 'Export chat',
      defaultPath,
      filters:
        req.format === 'md'
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null

    const body =
      req.format === 'md'
        ? renderMarkdown(session.title, messages)
        : JSON.stringify({ session, messages }, null, 2)

    await writeFile(result.filePath, body, 'utf8')
    logger.info(`exported session ${req.sessionId} to ${result.filePath}`)
    return result.filePath
  })
}

function renderMarkdown(title: string, messages: Message[]): string {
  const out: string[] = [`# ${title}`, '']

  for (const message of messages) {
    const when = new Date(message.createdAt).toISOString()
    const who =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'flashgent' : 'System'
    out.push(`## ${who} — ${when}`, '')
    if (message.model) out.push(`*model: ${message.model}*`, '')

    for (const block of message.blocks) {
      out.push(renderBlock(block))
    }
    out.push('')
  }
  return out.join('\n')
}

function renderBlock(block: ContentBlock): string {
  if (block.type === 'text') return `${block.text}\n`
  if (block.type === 'thinking') {
    return `<details><summary>Thinking</summary>\n\n${block.text}\n\n</details>\n`
  }

  const args = JSON.stringify(block.input, null, 2)
  const result = block.result?.content ?? '(no result)'
  return [
    `<details><summary>🔧 ${block.name} — ${block.status}</summary>`,
    '',
    '```json',
    args,
    '```',
    '',
    '```',
    result.slice(0, 4000),
    '```',
    '',
    '</details>',
    ''
  ].join('\n')
}
