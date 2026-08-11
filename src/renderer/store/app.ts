import type { AppInfo, McpStatus, McpToolInfo } from '@shared/ipc'
import {
  PERMISSION_MODES,
  type AskAnswer,
  type AskRequest,
  type AppConfig,
  type ContentBlock,
  type EffortLevel,
  type Message,
  type ModelPreset,
  type PermissionDecision,
  type PermissionMode,
  type Session,
  type TokenUsage
} from '@shared/types'
import { create } from 'zustand'
import { hasWorkflows } from '../agent/effort.js'
import { runAgent, type PermissionRequest } from '../agent/loop.js'
import { LmStudioClient, supportsNativeTools, type ModelInfo } from '../agent/lmstudio.js'
import { persistableRule } from '../agent/permissions.js'
import { createAskTool } from '../agent/tools/ask.js'
import { buildRegistry } from '../agent/tools/registry.js'
import { createSubtaskTool, type SubtaskRunner } from '../agent/tools/subtask.js'
import { makeNonce, wrapUntrusted } from '../agent/untrusted.js'
import { api, must, orElse } from '../lib/ipc.js'
import { recordPrefill } from '../lib/prefill.js'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
}

export interface AttachedFile {
  path: string
  content: string
  truncated: boolean
}

type ConnectionState = 'unknown' | 'checking' | 'ok' | 'error'

interface AppState {
  ready: boolean
  config: AppConfig | null
  info: AppInfo | null

  sessions: Session[]
  activeSessionId: string | null
  messages: Message[]
  /** Session ids the user has opened as tabs, in order. */
  openTabs: string[]

  models: ModelInfo[]
  connection: ConnectionState
  connectionError: string | null

  streaming: boolean
  liveBlocks: ContentBlock[]
  currentAction: string | null
  /** Long-running shell tasks still alive in the background. */
  backgroundTasks: number
  /** When the in-flight turn began, for the elapsed-time readout. */
  turnStartedAt: number
  /** Bumped once a second while streaming, purely to re-render the clock. */
  tick: number
  /** Set while a request is prefilling; cleared when the first token lands. */
  prefill: { model: string; promptTokens: number; startedAt: number } | null
  usage: TokenUsage | null
  contextTokens: number | null
  /**
   * FLASHGENT.md / CLAUDE.md as last read for a turn. Kept so the context
   * breakdown can account for them; they are read fresh for each turn.
   */
  projectInstructions: string

  pendingPermission: PermissionRequest | null
  pendingContinue: number | null
  /** Clarification the agent is waiting on. */
  pendingAsk: AskRequest | null

  mcpStatuses: McpStatus[]
  mcpTools: McpToolInfo[]

  attachments: AttachedFile[]
  toasts: Toast[]
  settingsOpen: boolean
  searchQuery: string

  // actions
  init: () => Promise<void>
  refreshModels: () => Promise<void>
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>
  newSession: (cwd?: string) => Promise<void>
  selectSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  toggleStar: (id: string) => Promise<void>
  setSessionModel: (model: string) => Promise<void>
  setSessionPreset: (presetId: string) => Promise<void>
  warmUpModel: (id: string) => Promise<void>
  setEffort: (effort: EffortLevel) => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  cyclePermissionMode: (direction: 1 | -1) => Promise<void>
  approvePlan: () => Promise<void>
  chooseWorkspace: () => Promise<void>
  closeTab: (id: string) => void

  send: (text: string) => Promise<void>
  stop: () => void
  rewindTo: (messageId: string) => Promise<void>
  forkFrom: (messageId: string) => Promise<void>
  retryLast: () => Promise<void>
  compact: () => Promise<void>

  resolvePermission: (decision: PermissionDecision) => void
  resolveContinue: (proceed: boolean) => void
  resolveAsk: (answers: AskAnswer[]) => void

  attachFiles: (paths: string[]) => Promise<void>
  removeAttachment: (path: string) => void
  saveSnippet: (code: string, language: string) => Promise<void>

  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setSettingsOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
  exportSession: (format: 'md' | 'json') => Promise<void>
}

/** Resolvers for the two places the loop pauses and waits on the user. */
let permissionResolver: ((d: PermissionDecision) => void) | null = null
let continueResolver: ((proceed: boolean) => void) | null = null
let askResolver: ((answers: AskAnswer[]) => void) | null = null
let abortController: AbortController | null = null

const uid = (): string => globalThis.crypto.randomUUID()

/**
 * One exchange is enough to be worth compacting: a single tool call can fill
 * most of a small window on its own.
 */
export const MIN_MESSAGES_TO_COMPACT = 2

/** Models that cannot do native tool calls, remembered for the session. */
const reactModels = new Set<string>()

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  config: null,
  info: null,
  sessions: [],
  activeSessionId: null,
  messages: [],
  openTabs: [],
  models: [],
  connection: 'unknown',
  connectionError: null,
  streaming: false,
  liveBlocks: [],
  currentAction: null,
  backgroundTasks: 0,
  turnStartedAt: 0,
  tick: 0,
  prefill: null,
  usage: null,
  contextTokens: null,
  projectInstructions: '',
  pendingPermission: null,
  pendingContinue: null,
  pendingAsk: null,
  mcpStatuses: [],
  mcpTools: [],
  attachments: [],
  toasts: [],
  settingsOpen: false,
  searchQuery: '',

  async init() {
    const config = must(await api().config.get())
    const info = must(await api().app.info())
    const sessions = orElse(await api().db.listSessions(), [])

    set({ config, info, sessions, ready: true })

    applyAppearance(config)

    api().on.mcpStatus((statuses) => {
      set({ mcpStatuses: statuses })
      void refreshMcpTools(set)
    })
    api().on.openPath((path) => {
      void get().newSession(path)
    })
    api().on.themeChanged(() => applyAppearance(get().config))

    await refreshMcpTools(set)
    await get().refreshModels()

    // A workspace passed on the command line always opens its own session.
    // Otherwise restore the most recent one, or start fresh.
    const latest = sessions[0]
    if (info.initialWorkspace) await get().newSession(info.initialWorkspace)
    else if (latest) await get().selectSession(latest.id)
    else await get().newSession(info.homeDir)
  },

  async refreshModels() {
    const config = get().config
    if (!config) return
    set({ connection: 'checking', connectionError: null })

    try {
      const models = await clientFor(config).listModels()
      const active = get().sessions.find((s) => s.id === get().activeSessionId)
      const selected = active?.model ?? config.lastModel ?? models[0]?.id ?? null
      const contextTokens =
        config.agent.contextTokensOverride ??
        models.find((m) => m.id === selected)?.contextLength ??
        null

      set({ models, connection: 'ok', connectionError: null, contextTokens })

      if (selected && !active?.model && get().activeSessionId) {
        await get().setSessionModel(selected)
      }
    } catch (err) {
      set({
        models: [],
        connection: 'error',
        connectionError: err instanceof Error ? err.message : String(err)
      })
    }
  },

  async saveConfig(patch) {
    const current = get().config
    if (!current) return
    const next = { ...current, ...patch }
    const saved = must(await api().config.set(next))
    set({ config: saved })
    applyAppearance(saved)
  },

  async newSession(cwd) {
    const { config, info } = get()
    const workspace = cwd ?? info?.homeDir ?? '.'
    const session = must(
      await api().db.createSession({
        cwd: workspace,
        model: config?.lastModel ?? get().models[0]?.id ?? null,
        presetId: config?.activePresetId ?? null,
        effort: config?.effort ?? 'high',
        permissionMode: config?.permissionMode ?? 'manual'
      })
    )
    set((s) => ({
      sessions: [session, ...s.sessions],
      openTabs: [...new Set([...s.openTabs, session.id])]
    }))
    await get().selectSession(session.id)
  },

  async selectSession(id) {
    if (get().streaming) get().stop()
    const messages = orElse(await api().db.listMessages(id), [])
    set((s) => ({
      activeSessionId: id,
      messages,
      liveBlocks: [],
      usage: null,
      attachments: [],
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id]
    }))

    const session = get().sessions.find((s) => s.id === id)
    const models = get().models
    const contextTokens =
      get().config?.agent.contextTokensOverride ??
      models.find((m) => m.id === session?.model)?.contextLength ??
      null
    set({ contextTokens })
  },

  async deleteSession(id) {
    must(await api().db.deleteSession(id))
    const remaining = get().sessions.filter((s) => s.id !== id)
    set((s) => ({ sessions: remaining, openTabs: s.openTabs.filter((t) => t !== id) }))

    if (get().activeSessionId === id) {
      const next = remaining[0]
      if (next) await get().selectSession(next.id)
      else await get().newSession()
    }
    get().toast('info', 'Session deleted')
  },

  async renameSession(id, title) {
    const updated = must(await api().db.updateSession(id, { title }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
  },

  async toggleStar(id) {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return
    const updated = must(await api().db.updateSession(id, { starred: !session.starred }))
    set((s) => ({
      sessions: [...s.sessions.map((x) => (x.id === id ? updated : x))].sort(sortSessions)
    }))
  },

  async setSessionModel(model) {
    const id = get().activeSessionId
    if (!id) return
    const updated = must(await api().db.updateSession(id, { model }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
    await get().saveConfig({ lastModel: model })

    const contextTokens =
      get().config?.agent.contextTokensOverride ??
      get().models.find((m) => m.id === model)?.contextLength ??
      null
    set({ contextTokens })
  },

  async setSessionPreset(presetId) {
    const id = get().activeSessionId
    if (!id) return
    const updated = must(await api().db.updateSession(id, { presetId }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
    await get().saveConfig({ activePresetId: presetId })
  },

  /**
   * LM Studio loads a model lazily, on the first request that names it. A
   * one-token completion is therefore the load button.
   */
  async warmUpModel(id) {
    const config = get().config
    if (!config) return

    get().toast('info', `Loading ${id}... this can take a few minutes.`)
    const controller = new AbortController()
    try {
      await clientFor(config).streamChat({
        model: id,
        messages: [{ role: 'user', content: 'ok' }],
        preset: { id: 'warmup', name: 'warmup', temperature: 0, maxTokens: 1 },
        signal: controller.signal,
        onDelta: () => undefined
      })
      get().toast('success', `${id} is loaded.`)
    } catch (err) {
      get().toast('error', err instanceof Error ? err.message : String(err))
    }
    await get().refreshModels()
  },

  async setEffort(effort) {
    const id = get().activeSessionId
    if (!id) return
    const updated = must(await api().db.updateSession(id, { effort }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
    await get().saveConfig({ effort })
  },

  async setPermissionMode(permissionMode) {
    const id = get().activeSessionId
    if (!id) return
    const updated = must(await api().db.updateSession(id, { permissionMode }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
    await get().saveConfig({ permissionMode })
  },

  async cyclePermissionMode(direction) {
    // Bypass is only in the rotation once the user has unlocked it.
    const available = PERMISSION_MODES.filter(
      (m) => m !== 'bypass' || get().config?.allowBypassMode
    )
    const current = get().sessions.find((s) => s.id === get().activeSessionId)?.permissionMode
    const index = Math.max(0, available.indexOf(current ?? 'manual'))
    const next = available[(index + direction + available.length) % available.length]
    if (next) await get().setPermissionMode(next)
  },

  /** Leave plan mode and tell the agent to carry the plan out. */
  async approvePlan() {
    if (get().streaming) return
    await get().setPermissionMode('acceptEdits')
    await get().send('Approved. Carry out the plan.')
  },

  async chooseWorkspace() {
    const picked = orElse(await api().fs.pickDirectory(), null)
    const id = get().activeSessionId
    if (!picked || !id) return
    const updated = must(await api().db.updateSession(id, { cwd: picked }))
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }))
    get().toast('success', `Workspace set to ${picked}`)
  },

  closeTab(id) {
    set((s) => ({ openTabs: s.openTabs.filter((t) => t !== id) }))
  },

  async send(text) {
    const { config, activeSessionId, streaming, attachments } = get()
    const session = get().sessions.find((s) => s.id === activeSessionId)
    if (!config || !session || streaming) return

    const model = session.model ?? config.lastModel ?? get().models[0]?.id
    if (!model) {
      get().toast('error', 'No model available. Load one in LM Studio, then reconnect.')
      return
    }

    // A file the user dropped in is still third-party content: fence it so its
    // contents cannot pose as instructions.
    const body = attachments.length
      ? `${text}\n\n${attachments
          .map(
            (a) =>
              wrapUntrusted({
                nonce: makeNonce(),
                source: `attached file ${a.path}${a.truncated ? ' (truncated)' : ''}`,
                content: a.content
              }).text
          )
          .join('\n\n')}`
      : text

    const userMessage: Message = {
      id: uid(),
      sessionId: session.id,
      role: 'user',
      blocks: [{ type: 'text', text: body }],
      model: null,
      createdAt: Date.now()
    }
    must(await api().db.appendMessage(userMessage))
    set((s) => ({ messages: [...s.messages, userMessage], attachments: [] }))

    // A session titled "New chat" takes its name from the opening message.
    if (session.title === 'New chat') {
      const title = text.trim().split('\n')[0]?.slice(0, 60) || 'New chat'
      await get().renameSession(session.id, title)
    }

    await streamAssistantTurn(set, get, session.id, model)
  },

  stop() {
    abortController?.abort()
    // Unblock the loop if it is parked on a prompt.
    permissionResolver?.('deny')
    continueResolver?.(false)
    askResolver?.([])
    permissionResolver = null
    continueResolver = null
    askResolver = null
    set({
      pendingPermission: null,
      pendingContinue: null,
      pendingAsk: null,
      currentAction: null
    })
  },

  async rewindTo(messageId) {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    if (get().streaming) get().stop()

    must(await api().db.truncateFrom(sessionId, messageId))
    const messages = orElse(await api().db.listMessages(sessionId), [])
    set({ messages, liveBlocks: [] })
    get().toast('info', 'Rewound to that point')
  },

  async forkFrom(messageId) {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    const fork = must(await api().db.forkSession(sessionId, messageId))
    set((s) => ({ sessions: [fork, ...s.sessions] }))
    await get().selectSession(fork.id)
    get().toast('success', `Forked to "${fork.title}"`)
  },

  async retryLast() {
    const { messages, activeSessionId, config } = get()
    const session = get().sessions.find((s) => s.id === activeSessionId)
    if (!session || !config || get().streaming) return

    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return

    must(await api().db.truncateFrom(session.id, last.id))
    set((s) => ({ messages: s.messages.filter((m) => m.id !== last.id) }))

    const model = session.model ?? config.lastModel ?? get().models[0]?.id
    if (model) await streamAssistantTurn(set, get, session.id, model)
  },

  async compact() {
    const { messages, activeSessionId, config } = get()
    const session = get().sessions.find((s) => s.id === activeSessionId)
    if (!session || !config) return

    // Failing silently here was indistinguishable from a dead button, so every
    // way out says why.
    if (get().streaming) {
      get().toast('info', 'Wait for the current turn to finish, then compact.')
      return
    }
    if (messages.length < MIN_MESSAGES_TO_COMPACT) {
      get().toast('info', 'Nothing to compact yet — there is no history to summarise.')
      return
    }

    const model = session.model ?? config.lastModel
    if (!model) {
      get().toast('error', 'Pick a model first — compacting needs one to write the summary.')
      return
    }

    set({ streaming: true, currentAction: 'Compacting the conversation' })
    try {
      const transcript = messages
        .map((m) => `${m.role}: ${plainText(m.blocks).slice(0, 4000)}`)
        .join('\n\n')

      const controller = new AbortController()
      abortController = controller
      const outcome = await clientFor(config).streamChat({
        model,
        preset: presetFor(config, session.presetId),
        signal: controller.signal,
        messages: [
          {
            role: 'system',
            content:
              'Summarise the conversation below so work can continue from the summary alone. ' +
              'Keep decisions made, file paths touched, current state, and open questions. Be terse.'
          },
          { role: 'user', content: transcript }
        ],
        onDelta: () => undefined
      })

      // A model that returns nothing but reasoning would otherwise replace the
      // whole conversation with an empty note. Keep the history instead.
      if (!outcome.text.trim()) {
        get().toast('error', 'The model returned an empty summary — history left as it was.')
        return
      }

      const summary: Message = {
        id: uid(),
        sessionId: session.id,
        role: 'user',
        blocks: [{ type: 'text', text: `[Compacted history]\n\n${outcome.text}` }],
        model: null,
        createdAt: Date.now()
      }

      const first = messages[0]
      if (first) must(await api().db.truncateFrom(session.id, first.id))
      must(await api().db.appendMessage(summary))
      set({ messages: [summary], usage: null })
      get().toast('success', 'Conversation compacted')
    } catch (err) {
      get().toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      abortController = null
      set({ streaming: false, currentAction: null })
    }
  },

  resolvePermission(decision) {
    const request = get().pendingPermission
    permissionResolver?.(decision)
    permissionResolver = null
    set({ pendingPermission: null })

    // Persist "Always" choices so they survive a restart.
    if (request && (decision === 'always-allow' || decision === 'always-deny')) {
      const config = get().config
      if (!config) return
      const rule = persistableRule(request.definition, request.input)
      const permissions =
        decision === 'always-allow'
          ? { ...config.permissions, allow: [...new Set([...config.permissions.allow, rule])] }
          : { ...config.permissions, deny: [...new Set([...config.permissions.deny, rule])] }
      void get().saveConfig({ permissions })
    }
  },

  resolveContinue(proceed) {
    continueResolver?.(proceed)
    continueResolver = null
    set({ pendingContinue: null })
  },

  resolveAsk(answers) {
    askResolver?.(answers)
    askResolver = null
    set({ pendingAsk: null })
  },

  async attachFiles(paths) {
    const session = get().sessions.find((s) => s.id === get().activeSessionId)
    if (!session) return
    const files = orElse(await api().fs.resolveDropped(paths, session.cwd), [])
    if (!files.length) {
      get().toast('error', 'Nothing attachable in that drop (too large, binary, or protected).')
      return
    }
    set((s) => {
      const existing = new Set(s.attachments.map((a) => a.path))
      const added = files
        .filter((f) => !existing.has(f.path))
        .map((f) => ({ path: f.path, content: f.content, truncated: f.truncated }))
      return { attachments: [...s.attachments, ...added] }
    })
  },

  removeAttachment(path) {
    set((s) => ({ attachments: s.attachments.filter((a) => a.path !== path) }))
  },

  async saveSnippet(code, language) {
    const title = code.trim().split('\n')[0]?.slice(0, 60) || 'Snippet'
    must(
      await api().db.createSnippet({
        title,
        language,
        code,
        sessionId: get().activeSessionId
      })
    )
    get().toast('success', 'Saved to snippets')
  },

  toast(kind, message) {
    const toast: Toast = { id: uid(), kind, message }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => get().dismissToast(toast.id), 3000)
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setSearchQuery(query) {
    set({ searchQuery: query })
  },

  async exportSession(format) {
    const id = get().activeSessionId
    if (!id) return
    try {
      const path = must(await api().app.exportSession({ sessionId: id, format }))
      if (path) get().toast('success', `Exported to ${path}`)
    } catch (err) {
      get().toast('error', err instanceof Error ? err.message : String(err))
    }
  }
}))

// --- turn execution --------------------------------------------------------

type Setter = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
type Getter = () => AppState

async function streamAssistantTurn(
  set: Setter,
  get: Getter,
  sessionId: string,
  model: string
): Promise<void> {
  const config = get().config
  const session = get().sessions.find((s) => s.id === sessionId)
  if (!config || !session) return

  const controller = new AbortController()
  abortController = controller

  set({
    streaming: true,
    liveBlocks: [],
    usage: null,
    currentAction: 'Working',
    turnStartedAt: Date.now(),
    backgroundTasks: 0
  })

  // Drives the elapsed-time readout.
  const clock = setInterval(() => set((s) => ({ tick: s.tick + 1 })), 1000)

  // Background shell tasks outlive the call that started them, so the status
  // line polls rather than being told.
  const backgroundPoll = setInterval(() => {
    void api()
      .shell.tasks()
      .then((result) => {
        if (result.ok) set({ backgroundTasks: result.value.filter((t) => t.running).length })
      })
  }, 2000)

  const projectInstructions = await readProjectInstructions(session.cwd)
  set({ projectInstructions })

  // Hypercode unlocks delegation. A subtask runs the same loop with a fresh
  // conversation and no delegation of its own, so it cannot recurse.
  const baseTools = buildRegistry(get().mcpTools)
  const workflows = hasWorkflows(session.effort)

  const runSubtask: SubtaskRunner = async (description, ctx, subSignal) => {
    const nested = await runAgent({
      client: clientFor(config),
      model,
      preset: presetFor(config, session.presetId),
      config: { ...config.agent, maxIterations: 20 },
      permissions: config.permissions,
      mode: session.permissionMode,
      effort: 'xhigh',
      registry: baseTools,
      history: [
        {
          id: uid(),
          sessionId,
          role: 'user',
          blocks: [{ type: 'text', text: description }],
          model: null,
          createdAt: Date.now()
        }
      ],
      cwd: ctx.cwd,
      platform: get().info?.platform ?? 'win32',
      projectInstructions,
      contextTokens: get().contextTokens,
      forceReact: reactModels.has(model),
      signal: subSignal,
      events: {
        onBlocks: () => undefined,
        onUsage: (usage) => set({ usage }),
        // A subtask has no user to ask, so it declines rather than hanging.
        onPermission: async () => 'deny',
        onIterationLimit: async () => false
      }
    })

    const prose = nested.blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    // A subtask that gathered findings but never wrote them up would otherwise
    // report nothing at all. Hand back what it actually saw instead.
    const text =
      prose ||
      nested.blocks
        .filter((b) => b.type === 'tool_use' && b.result?.ok)
        .map((b) => {
          const tool = b as Extract<ContentBlock, { type: 'tool_use' }>
          return `${tool.name}: ${tool.result?.content ?? ''}`.trim()
        })
        .join('\n\n')
        .trim()

    return { text, ok: nested.stopReason === 'done' }
  }

  // Asking the user is always available in the main conversation; a subtask
  // has nobody to ask, so `baseTools` deliberately leaves both tools out.
  const askTool = createAskTool(
    (request) =>
      new Promise<AskAnswer[]>((resolveAnswers) => {
        askResolver = resolveAnswers
        set({ pendingAsk: request, currentAction: 'Waiting for your answer' })
      })
  )

  const registry = buildRegistry(
    get().mcpTools,
    workflows ? [askTool, createSubtaskTool(runSubtask, controller.signal)] : [askTool]
  )

  // Checkpoint the partial answer periodically so a crash mid-run does not
  // lose a long tool-heavy turn.
  const assistantId = uid()
  let lastPersist = 0
  let persisted = false
  // Writes are chained rather than fired concurrently: two overlapping saves
  // would both see `persisted === false` and race to insert the same row.
  let writeQueue: Promise<void> = Promise.resolve()

  const persist = (blocks: ContentBlock[], usage?: TokenUsage): Promise<void> => {
    const run = writeQueue.then(async () => {
      if (persisted) {
        must(
          await api().db.updateMessage(assistantId, { blocks, ...(usage ? { usage } : {}) })
        )
        return
      }
      const message: Message = {
        id: assistantId,
        sessionId,
        role: 'assistant',
        blocks,
        model,
        createdAt: Date.now(),
        ...(usage ? { usage } : {})
      }
      must(await api().db.appendMessage(message))
      persisted = true
    })

    // A failed checkpoint must not poison the chain for later writes, but the
    // caller still sees the rejection.
    writeQueue = run.catch(() => undefined)
    return run
  }

  let result
  try {
    result = await runAgent({
      client: clientFor(config),
      model,
      preset: presetFor(config, session.presetId),
      config: config.agent,
      permissions: config.permissions,
      mode: session.permissionMode,
      effort: session.effort,
      registry,
      history: get().messages,
      cwd: session.cwd,
      platform: get().info?.platform ?? 'win32',
      projectInstructions,
      contextTokens: get().contextTokens,
      forceReact: reactModels.has(model),
      // Saves the whole text-protocol section on every request.
      nativeToolsConfirmed: supportsNativeTools(get().models.find((m) => m.id === model)) === true,
      signal: controller.signal,
      events: {
        onBlocks: (blocks) => {
          set({ liveBlocks: blocks, currentAction: describeAction(blocks) })
          if (Date.now() - lastPersist > 1500) {
            lastPersist = Date.now()
            void persist(blocks).catch(() => undefined)
          }
        },
        onUsage: (usage) => set({ usage }),
        onReactFallback: () => {
          reactModels.add(model)
          get().toast('info', `${model} has no native tool calling — using the text protocol.`)
        },
        onRequestStart: (promptTokens) =>
          set({ prefill: { model, promptTokens, startedAt: Date.now() } }),
        onFirstToken: () => {
          const pending = get().prefill
          if (pending) {
            recordPrefill(pending.model, pending.promptTokens, Date.now() - pending.startedAt)
          }
          set({ prefill: null })
        },
        onPhase: (phase) =>
          set({ currentAction: phase === 'reviewing' ? 'Reviewing its own work' : 'Working' }),
        onInjectionDetected: (findings) => {
          const labels = [...new Set(findings.map((f) => f.label))].join(', ')
          get().toast('error', `Ignored instructions hidden in tool output (${labels}).`)
          void api().app.log('warn', `prompt injection neutralised: ${labels}`)
        },
        onPermission: (request) =>
          new Promise((resolve) => {
            permissionResolver = resolve
            set({ pendingPermission: request, currentAction: 'Waiting for permission' })
          }),
        onIterationLimit: (iterations) =>
          new Promise((resolve) => {
            continueResolver = resolve
            set({ pendingContinue: iterations, currentAction: 'Waiting to continue' })
          })
      }
    })
  } catch (err) {
    result = {
      blocks: get().liveBlocks,
      stopReason: 'error' as const,
      error: err instanceof Error ? err.message : String(err),
      usedReact: false
    }
  }

  abortController = null
  clearInterval(backgroundPoll)
  clearInterval(clock)

  const blocks = result.blocks.length ? result.blocks : [emptyReplyNotice(result.stopReason)]

  // A reasoning model can spend its whole budget thinking and return nothing
  // visible. Say so, instead of leaving a blank turn.
  const visible = blocks.some((b) => b.type === 'text' && b.text.trim())
  if (!visible && result.stopReason === 'truncated') {
    blocks.push({
      type: 'text',
      text:
        '\n\n*The model hit its token limit before writing an answer — it spent the budget on ' +
        'reasoning. Raise **Max reply tokens** in Settings, or lower the effort level.*'
    })
  }

  if (result.stopReason === 'error' && result.error) {
    blocks.push({ type: 'text', text: `\n\n**Error:** ${result.error}` })
    get().toast('error', result.error)
  }
  if (result.stopReason === 'aborted') {
    blocks.push({ type: 'text', text: '\n\n*(stopped by user)*' })
  }

  try {
    await persist(blocks, result.usage)
  } catch (err) {
    // The turn already happened; failing to save it is worth reporting, not
    // worth throwing out of the store and into an unhandled rejection.
    const message = err instanceof Error ? err.message : String(err)
    api().app.log('error', `failed to save assistant message: ${message}`)
    get().toast('error', `Could not save this reply: ${message}`)
  }

  const messages = orElse(await api().db.listMessages(sessionId), get().messages)
  const sessions = orElse(await api().db.listSessions(), get().sessions)

  set({
    streaming: false,
    liveBlocks: [],
    currentAction: null,
    messages,
    sessions,
    pendingPermission: null,
    pendingContinue: null,
    pendingAsk: null
  })

  await maybeAutoCompact(get)
}

/**
 * Compact once the context is nearly full, so the next turn does not get
 * silently trimmed mid-conversation.
 */
async function maybeAutoCompact(get: Getter): Promise<void> {
  const state = get()
  const threshold = state.config?.agent.autoCompactAt ?? 0
  const limit = state.contextTokens
  const used = state.usage?.total ?? 0

  if (!threshold || !limit || used < limit * threshold) return

  state.toast('info', 'Context nearly full — compacting the conversation.')
  await state.compact()
}

// --- helpers ---------------------------------------------------------------

/** What to show when a turn produced no blocks at all. */
function emptyReplyNotice(stopReason: string): ContentBlock {
  if (stopReason === 'truncated') {
    return {
      type: 'text',
      text:
        'The model reached its token limit before producing an answer. Raise **Max reply tokens** ' +
        'in Settings, or choose a lower effort level.'
    }
  }
  return { type: 'text', text: '*The model returned an empty response.*' }
}

function clientFor(config: AppConfig): LmStudioClient {
  const endpoint =
    config.endpoints.find((e) => e.id === config.activeEndpointId) ?? config.endpoints[0]
  return new LmStudioClient(endpoint?.baseUrl ?? 'http://localhost:1234/v1')
}

function presetFor(config: AppConfig, presetId: string | null): ModelPreset {
  const fallback: ModelPreset = { id: 'default', name: 'Default', temperature: 0.3, maxTokens: 4096 }
  return (
    config.presets.find((p) => p.id === presetId) ??
    config.presets.find((p) => p.id === config.activePresetId) ??
    config.presets[0] ??
    fallback
  )
}

function sortSessions(a: Session, b: Session): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1
  return b.updatedAt - a.updatedAt
}

function plainText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
}

/** One-line status for the activity indicator. */
function describeAction(blocks: ContentBlock[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block?.type !== 'tool_use') continue
    if (block.status === 'running') return `Running ${block.name}`
    if (block.status === 'awaiting-permission') return `Waiting for permission: ${block.name}`
  }
  const last = blocks[blocks.length - 1]
  if (last?.type === 'thinking') return 'Thinking'
  return 'Writing'
}

async function refreshMcpTools(set: Setter): Promise<void> {
  const listing = await api().mcp.list()
  if (listing.ok) set({ mcpStatuses: listing.value.statuses, mcpTools: listing.value.tools })
}

/** FLASHGENT.md wins over CLAUDE.md; both are read if present. */
async function readProjectInstructions(cwd: string): Promise<string> {
  const parts: string[] = []
  for (const name of ['FLASHGENT.md', 'CLAUDE.md']) {
    const result = await api().fs.read({ path: name, cwd, limit: 400, optional: true })
    if (result.ok && result.value.content.trim()) {
      parts.push(`# ${name}\n${result.value.content}`)
    }
  }
  return parts.join('\n\n')
}

const TRANSCRIPT_SIZE: Record<string, string> = { small: '13px', medium: '14px', large: '15.5px' }
const TRANSCRIPT_WIDTH: Record<string, string> = {
  narrow: '48rem',
  medium: '60rem',
  wide: '76rem'
}

function applyAppearance(config: AppConfig | null): void {
  if (!config) return
  const root = document.documentElement
  const a = config.appearance

  const dark =
    a.theme === 'dark' ||
    (a.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  root.classList.toggle('dark', dark)
  root.classList.toggle('contrast', dark && a.highContrast)

  root.style.setProperty('--fg-accent', a.accent)
  root.style.setProperty('--fg-font-size', `${a.fontSize}px`)
  root.style.setProperty('--fg-transcript-size', TRANSCRIPT_SIZE[a.transcriptSize] ?? '14px')
  root.style.setProperty('--fg-transcript-width', TRANSCRIPT_WIDTH[a.transcriptWidth] ?? '48rem')
  root.style.setProperty(
    '--fg-code-font',
    a.codeFont.trim() ? `${a.codeFont}, var(--font-mono)` : 'var(--font-mono)'
  )
  root.style.setProperty(
    '--fg-ui-font',
    a.interfaceFont === 'sans' ? 'Inter, var(--font-sans)' : 'var(--font-sans)'
  )
}
