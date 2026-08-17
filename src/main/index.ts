import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { CH } from '../shared/ipc.js'
import { readConfig } from './configStore.js'
import { closeDatabase, openDatabase } from './db/index.js'
import { registerAppHandlers, setInitialWorkspace } from './ipc/app.js'
import { registerBenchmarkHandlers } from './ipc/benchmark.js'
import { registerDbHandlers } from './ipc/db.js'
import { registerFsHandlers } from './ipc/fs.js'
import { abortAllStreams, registerLlmHandlers } from './ipc/llm.js'
import { connectEnabledServers, disconnectAll, registerMcpHandlers } from './ipc/mcp.js'
import { registerNetHandlers } from './ipc/net.js'
import { killAllTasks, registerShellHandlers } from './ipc/shell.js'
import { initUpdater, registerUpdaterHandlers } from './ipc/updater.js'
import { initLogger, logger } from './logger.js'
import { ensureDirs, loadEnvFile, logDir } from './paths.js'
import { createMainWindow } from './window.js'

let mainWindow: BrowserWindow | null = null

/**
 * Single instance: a second launch (e.g. from the Explorer context menu)
 * focuses the existing window and forwards its path instead of starting a
 * second copy of the agent.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = extractPathArg(argv)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (path) mainWindow.webContents.send(CH.evtOpenPath, path)
    }
  })

  void bootstrap()
}

function extractPathArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (!existsSync(arg)) continue

    const absolute = resolve(arg)
    // `electron .` passes the app directory itself; that is not a workspace
    // the user asked to open.
    if (absolute === resolve(app.getAppPath())) continue

    try {
      // A file argument opens its containing directory as the workspace.
      return statSync(absolute).isDirectory() ? absolute : dirname(absolute)
    } catch {
      continue
    }
  }
  return null
}

async function bootstrap(): Promise<void> {
  ensureDirs()
  loadEnvFile()
  initLogger()

  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception in main', err.stack ?? String(err))
    void reportFatal(err)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection in main', String(reason))
  })

  await app.whenReady()

  try {
    openDatabase()
  } catch (err) {
    logger.error('database failed to open', String(err))
    dialog.showErrorBox(
      'flashgent could not start',
      `The local database could not be opened.\n\n${String(err)}\n\nLogs: ${logDir()}`
    )
    app.quit()
    return
  }

  const config = readConfig()
  applyTheme(config.appearance.theme)

  // Must be set before the renderer asks for app:info.
  setInitialWorkspace(extractPathArg(process.argv))

  registerAppHandlers()
  registerDbHandlers()
  registerFsHandlers()
  registerShellHandlers()
  registerNetHandlers()
  registerLlmHandlers()
  registerMcpHandlers()
  registerUpdaterHandlers()
  registerBenchmarkHandlers()
  initUpdater()

  mainWindow = createMainWindow(join(__dirname, '../preload/index.mjs'))
  loadRenderer(mainWindow)

  // MCP servers dial out in the background so a slow or dead server never
  // delays first paint.
  void connectEnabledServers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(join(__dirname, '../preload/index.mjs'))
      loadRenderer(mainWindow)
    }
  })
}

function loadRenderer(win: BrowserWindow): void {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyTheme(theme: 'system' | 'dark' | 'light'): void {
  nativeTheme.themeSource = theme
}

async function reportFatal(err: Error): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'flashgent hit an unexpected error',
    message: err.message,
    detail: `Your sessions are saved. A full trace is in:\n${logDir()}`,
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) {
    app.relaunch()
  }
  shutdown()
  app.exit(1)
}

function shutdown(): void {
  abortAllStreams()
  killAllTasks()
  void disconnectAll()
  closeDatabase()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', shutdown)
