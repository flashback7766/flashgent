import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH, type FlashgentApi } from '../shared/ipc.js'

/** Thin invoke helper — every handler already returns an IpcResult envelope. */
const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

/** Subscribe to a main->renderer event and hand back an unsubscribe fn. */
function subscribe(channel: string, handler: (...args: never[]) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    (handler as (...a: unknown[]) => void)(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: FlashgentApi = {
  config: {
    get: () => call(CH.configGet),
    set: (config) => call(CH.configSet, config),
    path: () => call(CH.configPath)
  },
  fs: {
    read: (req) => call(CH.fsRead, req),
    write: (req) => call(CH.fsWrite, req),
    edit: (req) => call(CH.fsEdit, req),
    glob: (req) => call(CH.fsGlob, req),
    grep: (req) => call(CH.fsGrep, req),
    listDir: (req) => call(CH.fsListDir, req),
    pickDirectory: () => call(CH.fsPickDirectory),
    pickFiles: (cwd) => call(CH.fsPickFiles, cwd),
    resolveDropped: (paths, cwd) => call(CH.fsResolveDropped, paths, cwd)
  },
  shell: {
    run: (req) => call(CH.shellRun, req),
    tasks: () => call(CH.shellTasks),
    output: (taskId) => call(CH.shellOutput, taskId),
    kill: (taskId) => call(CH.shellKill, taskId)
  },
  net: {
    fetch: (req) => call(CH.netFetch, req),
    search: (query) => call(CH.netSearch, query)
  },
  llm: {
    models: (baseUrl, apiKey) => call(CH.llmModels, baseUrl, apiKey),
    stream: (req) => call(CH.llmStream, req),
    abort: (requestId) => call(CH.llmAbort, requestId)
  },
  db: {
    listSessions: () => call(CH.dbSessionList),
    createSession: (input) => call(CH.dbSessionCreate, input),
    updateSession: (id, patch) => call(CH.dbSessionUpdate, id, patch),
    deleteSession: (id) => call(CH.dbSessionDelete, id),
    forkSession: (id, uptoMessageId) => call(CH.dbSessionFork, id, uptoMessageId),
    listMessages: (sessionId) => call(CH.dbMessageList, sessionId),
    appendMessage: (message) => call(CH.dbMessageAppend, message),
    updateMessage: (id, patch) => call(CH.dbMessageUpdate, id, patch),
    truncateFrom: (sessionId, messageId) => call(CH.dbMessageTruncate, sessionId, messageId),
    search: (query) => call(CH.dbSearch, query),
    listSnippets: () => call(CH.dbSnippetList),
    createSnippet: (s) => call(CH.dbSnippetCreate, s),
    deleteSnippet: (id) => call(CH.dbSnippetDelete, id)
  },
  mcp: {
    list: () => call(CH.mcpList),
    connect: (id) => call(CH.mcpConnect, id),
    disconnect: (id) => call(CH.mcpDisconnect, id),
    call: (server, tool, args) => call(CH.mcpCall, server, tool, args)
  },
  app: {
    info: () => call(CH.appInfo),
    log: (level, message) => {
      ipcRenderer.send(CH.appLog, level, message)
    },
    exportSession: (req) => call(CH.appExport, req),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  updater: {
    check: () => call(CH.updaterCheck),
    download: () => call(CH.updaterDownload),
    install: () => call(CH.updaterInstall)
  },
  benchmark: {
    run: () => call(CH.benchmarkRun),
    onProgress: (cb) => subscribe(CH.evtBenchmarkProgress, cb as never),
    onDone: (cb) => subscribe(CH.evtBenchmarkDone, cb as never)
  },
  on: {
    llmChunk: (cb) => subscribe(CH.evtLlmChunk, cb as never),
    mcpStatus: (cb) => subscribe(CH.evtMcpStatus, cb as never),
    themeChanged: (cb) => subscribe(CH.evtThemeChanged, cb as never),
    openPath: (cb) => subscribe(CH.evtOpenPath, cb as never),
    updateAvailable: (cb) => subscribe(CH.evtUpdateAvailable, cb as never),
    updateProgress: (cb) => subscribe(CH.evtUpdateProgress, cb as never),
    updateDownloaded: (cb) => subscribe(CH.evtUpdateDownloaded, cb as never)
  }
}

contextBridge.exposeInMainWorld('flashgent', api)
