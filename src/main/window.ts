import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CH } from '../shared/ipc.js'
import { logger } from './logger.js'
import { isDebug, userDataDir } from './paths.js'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 820, maximized: false }
const MIN_WIDTH = 940
const MIN_HEIGHT = 600

const stateFile = (): string => join(userDataDir(), 'window-state.json')

function readState(): WindowState {
  const file = stateFile()
  if (!existsSync(file)) return { ...DEFAULT_STATE }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<WindowState>
    const state: WindowState = {
      width: parsed.width ?? DEFAULT_STATE.width,
      height: parsed.height ?? DEFAULT_STATE.height,
      maximized: parsed.maximized ?? false
    }
    if (parsed.x !== undefined) state.x = parsed.x
    if (parsed.y !== undefined) state.y = parsed.y
    return visibleOnSomeScreen(state) ? state : { ...DEFAULT_STATE }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** Guard against restoring onto a monitor that is no longer attached. */
function visibleOnSomeScreen(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      state.x! >= a.x - 64 &&
      state.y! >= a.y - 64 &&
      state.x! < a.x + a.width &&
      state.y! < a.y + a.height
    )
  })
}

function persistState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized()
  }
  try {
    writeFileSync(stateFile(), JSON.stringify(state), 'utf8')
  } catch (err) {
    logger.warn('could not persist window state', String(err))
  }
}

export function createMainWindow(preloadPath: string): BrowserWindow {
  const state = readState()

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined ? { x: state.x } : {}),
    ...(state.y !== undefined ? { y: state.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'flashgent',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191917' : '#faf9f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => {
    win.show()
    if (isDebug()) win.webContents.openDevTools({ mode: 'detach' })
  })

  let saveTimer: NodeJS.Timeout | undefined
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => persistState(win), 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistState(win)
  })

  // External links open in the user's browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  nativeTheme.on('updated', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(CH.evtThemeChanged, nativeTheme.shouldUseDarkColors)
    }
  })

  return win
}
