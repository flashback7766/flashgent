/**
 * Core domain types shared between main, preload and renderer.
 *
 * The message model is a content-block array (Anthropic-style) so that an
 * assistant turn can interleave prose and tool calls in the order the model
 * produced them: text -> tool_use -> text -> tool_use -> ...
 */

export type Role = 'user' | 'assistant' | 'system'

export interface TextBlock {
  type: 'text'
  text: string
}

/** Reasoning emitted by the model. Collapsed in the UI behind "Show thinking". */
export interface ThinkingBlock {
  type: 'thinking'
  text: string
  /** Wall-clock time spent producing it. */
  durationMs?: number
  /** False while it is still streaming. */
  done?: boolean
  /** True once it approaches the effort level's thinking budget. */
  nearingBudget?: boolean
}

export type ToolStatus = 'pending' | 'awaiting-permission' | 'running' | 'ok' | 'error' | 'denied'

export interface ToolUseBlock {
  type: 'tool_use'
  /** Stable id used to correlate with the matching tool_result. */
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolStatus
  /** Populated once the tool settles. */
  result?: ToolResult
  /** Wall-clock duration in ms, for the profiling readout. */
  durationMs?: number
}

export interface ToolResult {
  ok: boolean
  /** Model-facing payload. Always a string; large outputs are pre-truncated. */
  content: string
  /** Renderer-only extras (diffs, file paths, exit codes) that never hit the model. */
  display?: ToolDisplay
  /** Injection attempts spotted in this output. Surfaced in the UI. */
  flagged?: InjectionFinding[]
}

/** A piece of tool output that tried to issue instructions to the agent. */
export interface InjectionFinding {
  label: string
  evidence: string
}

export interface ToolDisplay {
  kind: 'diff' | 'file' | 'shell' | 'list' | 'plain'
  title?: string
  path?: string
  language?: string
  exitCode?: number
  /** Set when `content` was clipped to fit the context window. */
  truncated?: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

export interface Message {
  id: string
  sessionId: string
  role: Role
  blocks: ContentBlock[]
  /** Model that produced this message; null for user messages. */
  model: string | null
  createdAt: number
  /** Token accounting reported by the server, when available. */
  usage?: TokenUsage
  /** Time from the first generated token to the end of the reply. */
  generationMs?: number
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface Session {
  id: string
  title: string
  /** Working directory the agent's tools are rooted at. */
  cwd: string
  model: string | null
  presetId: string | null
  effort: EffortLevel
  permissionMode: PermissionMode
  starred: boolean
  /** Set when this session was forked from another. */
  forkedFrom: string | null
  createdAt: number
  updatedAt: number
}

// --- Tools -----------------------------------------------------------------

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  parameters: JSONSchema
  /**
   * Risk class drives the permission prompt:
   *  - 'read'    executes without asking
   *  - 'write'   asks unless allowlisted
   *  - 'execute' asks unless allowlisted
   */
  risk: 'read' | 'write' | 'execute'
  /**
   * Safe to run alongside other calls in the same turn even though it is not
   * a read. Set by tools whose contract is that the caller only dispatches
   * independent work.
   */
  concurrent?: boolean
  /** MCP server this tool came from, if any. Built-ins leave this undefined. */
  server?: string
}

export interface JSONSchema {
  type: 'object'
  properties: Record<string, JSONSchemaProperty>
  required?: string[]
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: string[]
  items?: JSONSchemaProperty
  /** Nested shape, for object properties. */
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  default?: unknown
}

/** A decision the user made on a permission card. */
export type PermissionDecision = 'allow' | 'deny' | 'always-allow' | 'always-deny'

// --- Clarification ---------------------------------------------------------

export interface AskOption {
  label: string
  description: string
}

export interface AskQuestion {
  /** Short chip above the card, e.g. "Storage". */
  header: string
  question: string
  multiSelect: boolean
  options: AskOption[]
}

export interface AskRequest {
  questions: AskQuestion[]
}

/** One answer per question, in the order they were asked. */
export interface AskAnswer {
  question: string
  /** Labels the user picked. Empty when skipped. */
  selected: string[]
  /** Free text typed into "Other", if any. */
  other: string
  skipped: boolean
}

// --- Configuration ---------------------------------------------------------

export interface ModelPreset {
  id: string
  name: string
  temperature: number
  topP?: number
  topK?: number
  minP?: number
  repeatPenalty?: number
  frequencyPenalty?: number
  maxTokens: number
  stop?: string[]
}

export interface EndpointConfig {
  id: string
  name: string
  baseUrl: string
}

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'sse' | 'http' | 'ws'
  /** stdio only */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** sse / http / ws only */
  url?: string
}

export interface PermissionRules {
  /** Tool names (or `shell:<prefix>`) that never prompt. */
  allow: string[]
  /** Tool names (or `shell:<prefix>`) that are always refused. */
  deny: string[]
}

export interface AppearanceConfig {
  /** 'system' follows the OS light/dark preference. */
  theme: 'system' | 'dark' | 'light'
  /** Near-black background when dark mode is on. */
  highContrast: boolean
  accent: string
  fontSize: number
  /** Font for the interface itself. */
  interfaceFont: 'system' | 'sans'
  /** Monospace family for code blocks and shell output. Empty = built-in. */
  codeFont: string
  transcriptSize: 'small' | 'medium' | 'large'
  transcriptWidth: 'narrow' | 'medium' | 'wide'
  syntaxTheme: string
  showLineNumbers: boolean
  collapseCodeOverLines: number
}

/**
 * How hard the agent works on a turn. Local models expose no native effort
 * knob, so this drives several parameters at once — see `effort.ts`.
 */
export type EffortLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'hypercode'

export const EFFORT_ORDER: EffortLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'hypercode'
]

/**
 * How much the agent may do without asking.
 *  - manual       every write and command is confirmed
 *  - acceptEdits  file edits go through, commands are confirmed
 *  - plan         read-only; the agent produces a plan and waits for approval
 *  - auto         everything except commands that look destructive
 *  - bypass       no prompts at all
 */
export type PermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'bypass'

export const PERMISSION_MODES: PermissionMode[] = [
  'manual',
  'acceptEdits',
  'plan',
  'auto',
  'bypass'
]

export interface AgentConfig {
  /** Extra instructions appended to the system prompt. */
  persona: string
  maxIterations: number
  toolTimeoutMs: number
  parallelTools: boolean
  /** Fraction of the model's context window we're willing to fill. */
  contextUtilisation: number
  /** null = derive from the server's reported window. */
  contextTokensOverride: number | null
  /** Ask the model to reason after every tool result, not just at the start. */
  thinkAfterEachTool: boolean
  /** Compact automatically once the context is this full (0-1); 0 disables it. */
  autoCompactAt: number
  /**
   * Ceiling on how much of a tool's output reaches the model. Lower values
   * keep prefill affordable on modest hardware.
   */
  maxToolOutputChars: number
}

export interface AppConfig {
  version: number
  endpoints: EndpointConfig[]
  activeEndpointId: string
  lastModel: string | null
  presets: ModelPreset[]
  activePresetId: string
  effort: EffortLevel
  permissionMode: PermissionMode
  agent: AgentConfig
  permissions: PermissionRules
  appearance: AppearanceConfig
  mcpServers: McpServerConfig[]
  keybindings: Record<string, string>
  telemetryOptIn: boolean
  onboardingCompleted: boolean
  /**
   * Gate on the bypass mode. Off by default so Shift+Tab cannot land on
   * "run anything without asking" by accident.
   */
  allowBypassMode: boolean
}

// --- IPC payloads ----------------------------------------------------------

export interface FileReadRequest {
  path: string
  cwd: string
  offset?: number
  limit?: number
  /** Probe for a file that may not exist: return empty rather than failing. */
  optional?: boolean
}

export interface FileReadResult {
  path: string
  content: string
  totalLines: number
  truncated: boolean
}

export interface FileWriteRequest {
  path: string
  cwd: string
  content: string
  sessionId?: string
  messageId?: string
  toolCallId?: string
}

export interface FileEditRequest {
  path: string
  cwd: string
  oldString: string
  newString: string
  replaceAll?: boolean
  sessionId?: string
  messageId?: string
  toolCallId?: string
}

export interface FileEditResult {
  path: string
  replacements: number
  diff: string
}

export interface GlobRequest {
  pattern: string
  cwd: string
  limit?: number
}

export interface GrepRequest {
  pattern: string
  cwd: string
  glob?: string
  caseInsensitive?: boolean
  limit?: number
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}

export interface ShellRequest {
  command: string
  cwd: string
  timeoutMs?: number
  shell?: 'powershell' | 'bash'
  background?: boolean
  /** Ceiling on the output handed back, so a noisy command cannot flood the prompt. */
  maxOutputChars?: number
}

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  /** Present when `background` was requested. */
  taskId?: string
}

export interface BackgroundTask {
  id: string
  command: string
  cwd: string
  running: boolean
  exitCode: number | null
  startedAt: number
}

export interface FetchRequest {
  url: string
  maxBytes?: number
}

export interface FetchResult {
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

export interface UpdateInfo {
  available: boolean
  version?: string
  releaseDate?: string
  releaseNotes?: string
  downloaded?: boolean
  error?: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

/** Uniform envelope for every IPC call so the renderer never sees a raw throw. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

// --- Benchmark -------------------------------------------------------------

export type BenchmarkTier = 'easy' | 'medium' | 'hard' | 'hell'

export interface ScenarioResult {
  id: string
  name: string
  tier: BenchmarkTier
  maxPoints: number
  earnedPoints: number
  passed: boolean
  durationMs: number
  message?: string
}

export interface BenchmarkQualityScore {
  toolSyntaxPrecision: number
  thinkingEfficiency: number
  executionSpeedAndEconomy: number
  totalModifier: number
}

export interface BenchmarkSummary {
  easy: { passed: number; total: number; score: number; max: number }
  medium: { passed: number; total: number; score: number; max: number }
  hard: { passed: number; total: number; score: number; max: number }
  hell: { passed: number; total: number; score: number; max: number }
}

/**
 * Canonical benchmark report shape used everywhere — main, renderer, tests.
 * Field names match what runner.ts produces (totalScore / maxScore).
 */
export interface BenchmarkReport {
  timestamp: string
  modelName: string
  totalScore: number
  maxScore: number
  rawScore?: number
  rawMaxScore?: number
  percentage: number
  summary: BenchmarkSummary
  qualityModifiers: BenchmarkQualityScore
  scenarios: ScenarioResult[]
}

export interface BenchmarkProgress {
  index: number
  total: number
  scenario: string
  score: number
}

export interface BenchmarkRunRecord {
  id: string
  model: string
  score: number
  maxScore: number
  percentage: number
  report: BenchmarkReport
  createdAt: number
}

export interface FileSnapshot {
  id: string
  sessionId: string
  messageId?: string | null
  toolCallId?: string | null
  path: string
  contentBefore: string | null
  contentAfter: string | null
  createdAt: number
}

export interface ProjectIndexSummary {
  filesCount: number
  keyFiles: string[]
  exports: Array<{ file: string; symbols: string[] }>
  structureText: string
}

export interface BrowsePageRequest {
  url: string
  waitForSelector?: string
  timeoutMs?: number
  captureScreenshot?: boolean
}

export interface BrowsePageResult {
  url: string
  title: string
  content: string
  consoleErrors: string[]
  screenshotBase64?: string
  status: number
}
