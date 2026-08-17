import type {
  AppConfig,
  BackgroundTask,
  EffortLevel,
  PermissionMode,
  FetchRequest,
  FetchResult,
  FileEditRequest,
  FileEditResult,
  FileReadRequest,
  FileReadResult,
  FileWriteRequest,
  GlobRequest,
  GrepMatch,
  GrepRequest,
  IpcResult,
  Message,
  Session,
  ShellRequest,
  ShellResult,
  UpdateInfo,
  UpdateProgress
} from './types.js'

/** Channel names. Kept in one place so main and preload cannot drift apart. */
export const CH = {
  configGet: 'config:get',
  configSet: 'config:set',
  configPath: 'config:path',

  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsEdit: 'fs:edit',
  fsGlob: 'fs:glob',
  fsGrep: 'fs:grep',
  fsListDir: 'fs:listDir',
  fsPickDirectory: 'fs:pickDirectory',
  fsPickFiles: 'fs:pickFiles',
  fsResolveDropped: 'fs:resolveDropped',

  shellRun: 'shell:run',
  shellTasks: 'shell:tasks',
  shellOutput: 'shell:output',
  shellKill: 'shell:kill',

  netFetch: 'net:fetch',
  netSearch: 'net:search',

  llmModels: 'llm:models',
  llmStream: 'llm:stream',
  llmAbort: 'llm:abort',

  dbSessionList: 'db:session:list',
  dbSessionCreate: 'db:session:create',
  dbSessionUpdate: 'db:session:update',
  dbSessionDelete: 'db:session:delete',
  dbSessionFork: 'db:session:fork',
  dbMessageList: 'db:message:list',
  dbMessageAppend: 'db:message:append',
  dbMessageUpdate: 'db:message:update',
  dbMessageTruncate: 'db:message:truncate',
  dbSearch: 'db:search',
  dbSnippetList: 'db:snippet:list',
  dbSnippetCreate: 'db:snippet:create',
  dbSnippetDelete: 'db:snippet:delete',

  mcpList: 'mcp:list',
  mcpConnect: 'mcp:connect',
  mcpDisconnect: 'mcp:disconnect',
  mcpCall: 'mcp:call',

  appInfo: 'app:info',
  appLog: 'app:log',
  appExport: 'app:export',

  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterInstall: 'updater:install',

  /** main -> renderer */
  evtLlmChunk: 'evt:llm:chunk',
  evtShellData: 'evt:shell:data',
  evtMcpStatus: 'evt:mcp:status',
  evtThemeChanged: 'evt:theme:changed',
  evtOpenPath: 'evt:open:path',
  evtUpdateAvailable: 'evt:update:available',
  evtUpdateProgress: 'evt:update:progress',
  evtUpdateDownloaded: 'evt:update:downloaded'
} as const

export interface SessionCreateInput {
  title?: string
  cwd: string
  model?: string | null
  presetId?: string | null
  effort?: EffortLevel
  permissionMode?: PermissionMode
  forkedFrom?: string | null
}

export interface SessionSearchHit {
  sessionId: string
  title: string
  snippet: string
  createdAt: number
}

export interface SessionSearchQuery {
  text?: string
  model?: string
  from?: number
  to?: number
  limit?: number
}

export interface LlmModelInfo {
  id: string
  contextLength: number | null
  loaded: boolean
  /** What the server says the model can do, e.g. `tool_use`. */
  capabilities: string[]
}

export interface LlmStreamRequest {
  /** Correlates the chunk events with this call. */
  requestId: string
  baseUrl: string
  apiKey?: string
  /** The OpenAI-shaped request body, built by the renderer. */
  body: Record<string, unknown>
}

export interface LlmStreamResult {
  ok: boolean
  error?: string
  aborted?: boolean
}

export interface Snippet {
  id: string
  title: string
  language: string
  code: string
  sessionId: string | null
  createdAt: number
}

export interface McpToolInfo {
  server: string
  name: string
  description: string
  inputSchema: unknown
}

export interface McpStatus {
  id: string
  name: string
  connected: boolean
  error: string | null
  toolCount: number
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  platform: string
  userDataPath: string
  configPath: string
  logPath: string
  debug: boolean
  homeDir: string
  /**
   * Workspace passed on the command line (CLI arg, or the Explorer "Open dir
   * with flashgent" entry). The renderer pulls this rather than relying on a
   * push, which would race against React mounting.
   */
  initialWorkspace: string | null
}

export interface ExportRequest {
  sessionId: string
  format: 'md' | 'json'
}

/** The surface exposed on `window.flashgent` by the preload bridge. */
export interface FlashgentApi {
  config: {
    get(): Promise<IpcResult<AppConfig>>
    set(config: AppConfig): Promise<IpcResult<AppConfig>>
    path(): Promise<IpcResult<string>>
  }
  fs: {
    read(req: FileReadRequest): Promise<IpcResult<FileReadResult>>
    write(req: FileWriteRequest): Promise<IpcResult<{ path: string; created: boolean }>>
    edit(req: FileEditRequest): Promise<IpcResult<FileEditResult>>
    glob(req: GlobRequest): Promise<IpcResult<string[]>>
    grep(req: GrepRequest): Promise<IpcResult<GrepMatch[]>>
    listDir(req: { path: string; cwd: string }): Promise<IpcResult<string[]>>
    pickDirectory(): Promise<IpcResult<string | null>>
    pickFiles(cwd: string): Promise<IpcResult<string[]>>
    resolveDropped(paths: string[], cwd: string): Promise<IpcResult<FileReadResult[]>>
  }
  shell: {
    run(req: ShellRequest): Promise<IpcResult<ShellResult>>
    tasks(): Promise<IpcResult<BackgroundTask[]>>
    output(taskId: string): Promise<IpcResult<ShellResult>>
    kill(taskId: string): Promise<IpcResult<boolean>>
  }
  net: {
    fetch(req: FetchRequest): Promise<IpcResult<FetchResult>>
    search(query: string): Promise<IpcResult<FetchResult>>
  }
  /**
   * The model server. Lives in main because a browser context turns every
   * call into a CORS preflight that LM Studio answers with an error.
   */
  llm: {
    models(baseUrl: string, apiKey?: string): Promise<IpcResult<LlmModelInfo[]>>
    stream(req: LlmStreamRequest): Promise<IpcResult<LlmStreamResult>>
    abort(requestId: string): Promise<IpcResult<boolean>>
  }
  db: {
    listSessions(): Promise<IpcResult<Session[]>>
    createSession(input: SessionCreateInput): Promise<IpcResult<Session>>
    updateSession(id: string, patch: Partial<Session>): Promise<IpcResult<Session>>
    deleteSession(id: string): Promise<IpcResult<boolean>>
    forkSession(id: string, uptoMessageId: string): Promise<IpcResult<Session>>
    listMessages(sessionId: string): Promise<IpcResult<Message[]>>
    appendMessage(message: Message): Promise<IpcResult<Message>>
    updateMessage(id: string, patch: Partial<Message>): Promise<IpcResult<Message>>
    truncateFrom(sessionId: string, messageId: string): Promise<IpcResult<number>>
    search(query: SessionSearchQuery): Promise<IpcResult<SessionSearchHit[]>>
    listSnippets(): Promise<IpcResult<Snippet[]>>
    createSnippet(s: Omit<Snippet, 'id' | 'createdAt'>): Promise<IpcResult<Snippet>>
    deleteSnippet(id: string): Promise<IpcResult<boolean>>
  }
  mcp: {
    list(): Promise<IpcResult<{ statuses: McpStatus[]; tools: McpToolInfo[] }>>
    connect(id: string): Promise<IpcResult<McpStatus>>
    disconnect(id: string): Promise<IpcResult<boolean>>
    call(
      server: string,
      tool: string,
      args: Record<string, unknown>
    ): Promise<IpcResult<{ content: string; isError: boolean }>>
  }
  app: {
    info(): Promise<IpcResult<AppInfo>>
    log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void
    exportSession(req: ExportRequest): Promise<IpcResult<string | null>>
    /**
     * Absolute path of a dropped File. Electron removed `File.path` in v32,
     * so this has to come from `webUtils` on the preload side.
     */
    pathForFile(file: File): string
  }
  updater: {
    check(): Promise<IpcResult<UpdateInfo>>
    download(): Promise<IpcResult<boolean>>
    install(): Promise<IpcResult<boolean>>
  }
  on: {
    /** Raw SSE text for an in-flight completion. */
    llmChunk(cb: (requestId: string, chunk: string) => void): () => void
    shellData(cb: (taskId: string, chunk: string, stream: 'stdout' | 'stderr') => void): () => void
    mcpStatus(cb: (statuses: McpStatus[]) => void): () => void
    themeChanged(cb: (isDark: boolean) => void): () => void
    openPath(cb: (path: string) => void): () => void
    updateAvailable(cb: (info: UpdateInfo) => void): () => void
    updateProgress(cb: (progress: UpdateProgress) => void): () => void
    updateDownloaded(cb: (info: UpdateInfo) => void): () => void
  }
}
