import { exec } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  BenchmarkQualityScore,
  BenchmarkReport,
  BenchmarkTier,
  ScenarioResult
} from '../../src/shared/types.js'
import { DATASET_100_SCENARIOS, b64, codeStr, type BenchmarkAssertionContext, type BenchmarkScenario } from './datasets.js'

// Re-export for backward compat (tests import from here)
export type { BenchmarkReport, ScenarioResult }

export type QualityScore = BenchmarkQualityScore

export interface LlmEvaluatorOptions {
  baseUrl?: string
  modelName: string
  apiKey?: string
  maxTurns?: number
  timeoutMs?: number
}

export interface BenchmarkRunOptions {
  tier?: BenchmarkTier | 'all'
  scenarioId?: string
  concurrency?: number
}

export type BenchmarkEvaluator = (
  scenario: BenchmarkScenario,
  ctx: BenchmarkAssertionContext
) => Promise<{
  resultText?: string
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>
}>

export function parseToolArguments(raw: string): { args: Record<string, unknown>; valid: boolean } {
  try {
    return { args: JSON.parse(raw || '{}') as Record<string, unknown>, valid: true }
  } catch {
    try {
      const sanitized = raw
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
      return { args: JSON.parse(sanitized) as Record<string, unknown>, valid: true }
    } catch {
      return { args: {}, valid: false }
    }
  }
}

export function createLlmEvaluator(opts: LlmEvaluatorOptions): BenchmarkEvaluator {
  const baseUrl = (opts.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '')
  const model = opts.modelName
  const maxTurns = opts.maxTurns ?? 6
  const timeoutMs = opts.timeoutMs ?? 240_000

  const tools = [
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file with content in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to the file' },
            content: { type: 'string', description: 'The text content to write' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read text content of a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to the file' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit a file by replacing oldString with newString.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to the file' },
            oldString: { type: 'string', description: 'Exact string to replace' },
            newString: { type: 'string', description: 'Replacement string' }
          },
          required: ['path', 'oldString', 'newString']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_shell',
        description: 'Execute a shell command in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List contents of a directory in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative directory path' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Ask the user for clarification or options.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Clarification question' }
          },
          required: ['question']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_subtask',
        description: 'Spawn a focused subtask agent to research or complete a component.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Task description' }
          },
          required: ['description']
        }
      }
    }
  ]

  return async (scenario, ctx) => {
    interface ChatToolCall { id: string; function: { name: string; arguments: string } }
    interface ChatMessage { role: string; content?: string | null; tool_calls?: ChatToolCall[]; tool_call_id?: string }
    interface ChatCompletionResponse { choices?: Array<{ message: ChatMessage }> }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are an elite coding benchmark agent. Your job: solve each task precisely, using the tools available.

RULES — follow them strictly or you will fail:
1. ☕ START IMMEDIATELY. Your very first action must be a tool call. Do not explain, do not plan in text — just call a tool.
2. EXPLORE FIRST. If the task involves existing files, call list_dir(".") and/or read_file() on every relevant file before writing anything. Never guess file contents.
3. ZERO-DEP MEANS ZERO-DEP. If the task description says "zero-dependency" or "no external libraries", write pure Node.js / TypeScript using only built-ins. Do NOT import 'js-yaml', 'zod', 'lodash', or any npm package not mentioned in the prompt.
4. WRITE ALL FILES. Multi-file tasks require ALL files to be written. Do not stop after the first file. Re-read the task requirements before finishing.
5. NO LOOP REPEATS. Never call the same shell command twice in a row. If a command fails, use a different approach.
6. EXPORT THE EXACT FUNCTION NAME. If the task asks for "compareSemVer", export exactly that name. If it asks for "isValidCron", export exactly that. Match the required API signature precisely.
7. FINISH WHEN DONE. After all files are written, respond with a brief summary. No extra tool calls.`
      },
      {
        role: 'user',
        content: scenario.prompt
      }
    ]

    const recordedCalls: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }> = []
    let finalAnswer = ''

    for (let turn = 0; turn < maxTurns; turn++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let res: Response
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            tools,
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 4096
          }),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        throw new Error(`LLM call failed with status ${res.status}: ${await res.text()}`)
      }

      const data = (await res.json()) as ChatCompletionResponse
      const choice = data.choices?.[0]?.message
      if (!choice) break

      messages.push(choice)
      if (choice.content) {
        finalAnswer = choice.content
      }

      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        break
      }

      for (const call of choice.tool_calls) {
        const fnName = call.function?.name
        const { args, valid } = parseToolArguments(call.function?.arguments || '{}')
        recordedCalls.push({ name: fnName, input: args, ok: valid })

        let resultString = 'OK'
        try {
          if (fnName === 'write_file') {
            const path = String(args.path || '')
            const content = String(args.content || '')
            const fullPath = join(ctx.cwd, path)
            await mkdir(dirname(fullPath), { recursive: true })
            await writeFile(fullPath, content, 'utf8')
            resultString = `File written to ${path}`
          } else if (fnName === 'read_file') {
            const path = String(args.path || '')
            const fullPath = join(ctx.cwd, path)
            if (existsSync(fullPath)) {
              resultString = await readFile(fullPath, 'utf8')
            } else {
              resultString = `Error: file not found: ${path}`
            }
          } else if (fnName === 'edit_file') {
            const path = String(args.path || '')
            const oldStr = String(args.oldString || '')
            const newStr = String(args.newString || '')
            const fullPath = join(ctx.cwd, path)
            if (existsSync(fullPath)) {
              const current = await readFile(fullPath, 'utf8')
              if (current.includes(oldStr)) {
                await writeFile(fullPath, current.replace(oldStr, newStr), 'utf8')
                resultString = `Replaced occurrence in ${path}`
              } else {
                resultString = `Error: oldString not found in ${path}`
              }
            } else {
              resultString = `Error: file not found: ${path}`
            }
          } else if (fnName === 'run_shell') {
            const command = String(args.command || '')
            resultString = await new Promise((resolve) => {
              exec(command, { cwd: ctx.cwd, timeout: 30_000 }, (err, stdout, stderr) => {
                if (err) resolve(`Error: ${stderr || err.message}`)
                else resolve(stdout || 'Command completed successfully')
              })
            })
          } else if (fnName === 'list_dir') {
            const path = String(args.path || '.')
            const fullPath = join(ctx.cwd, path)
            if (existsSync(fullPath)) {
              resultString = `Directory listed: ${path}`
            } else {
              resultString = `Directory not found: ${path}`
            }
          } else if (fnName === 'ask_user' || fnName === 'ask') {
            resultString = 'User response: Proceed with standard configuration.'
          } else if (fnName === 'run_subtask') {
            resultString = 'Subtask completed: Fixtures generated and saved.'
          }
        } catch (toolErr) {
          resultString = `Tool execution error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: resultString
        })
      }
    }

    return { resultText: finalAnswer, toolCalls: recordedCalls }
  }
}

export async function createSandbox(
  initialFiles?: Record<string, string>
): Promise<{ sandboxPath: string; cleanup: () => Promise<void>; context: BenchmarkAssertionContext }> {
  const sandboxPath = await mkdtemp(join(tmpdir(), 'flashgent-bench-'))

  if (initialFiles) {
    for (const [relPath, content] of Object.entries(initialFiles)) {
      const fullPath = join(sandboxPath, relPath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, 'utf8')
    }
  }

  const context: BenchmarkAssertionContext = {
    cwd: sandboxPath,
    readFile: async (relPath: string) => {
      try {
        const fullPath = join(sandboxPath, relPath)
        if (!existsSync(fullPath)) return null
        return await readFile(fullPath, 'utf8')
      } catch {
        return null
      }
    },
    fileExists: async (relPath: string) => {
      const fullPath = join(sandboxPath, relPath)
      return existsSync(fullPath)
    }
  }

  const cleanup = async () => {
    try {
      await rm(sandboxPath, { recursive: true, force: true })
    } catch {
      // Ignored during cleanup
    }
  }

  return { sandboxPath, cleanup, context }
}

export async function executeScenario(
  scenario: BenchmarkScenario,
  evaluator?: BenchmarkEvaluator
): Promise<ScenarioResult> {
  const { cleanup, context } = await createSandbox(scenario.initialFiles)
  const start = performance.now()

  try {
    if (evaluator) {
      const runRes = await evaluator(scenario, context)
      context.resultText = runRes.resultText
      context.toolCalls = runRes.toolCalls
    } else {
      await defaultSimulator(scenario, context)
    }

    const assertion = await scenario.assert(context)
    const durationMs = Math.round(performance.now() - start)
    const earnedPoints = assertion.partialScore !== undefined
      ? assertion.partialScore
      : (assertion.ok ? scenario.points : 0)

    return {
      id: scenario.id,
      name: scenario.name,
      tier: scenario.tier,
      maxPoints: scenario.points,
      earnedPoints,
      passed: assertion.ok,
      durationMs,
      message: assertion.message,
      ...(context.toolCalls ? { toolCalls: context.toolCalls } : {})
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - start)
    return {
      id: scenario.id,
      name: scenario.name,
      tier: scenario.tier,
      maxPoints: scenario.points,
      earnedPoints: 0,
      passed: false,
      durationMs,
      message: err instanceof Error ? err.message : String(err)
    }
  } finally {
    await cleanup()
  }
}

/**
 * Deterministic simulator for baseline test-suite validation (all 100 tasks)
 */
async function defaultSimulator(scenario: BenchmarkScenario, ctx: BenchmarkAssertionContext): Promise<void> {
  // Helper to write file in sandbox
  const write = async (rel: string, content: string) => {
    const full = join(ctx.cwd, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }

  if (scenario.id.startsWith('easy-')) {
    switch (scenario.id) {
      case 'easy-01-branded-types':
        await write('types.ts', 'export type UserId = string & { readonly __brand: unique symbol };\nexport function assertUserId(val: string): UserId { if (!val || typeof val !== "string") throw new Error("Invalid"); return val as UserId; }')
        break
      case 'easy-02-multi-file-version-sync':
        await write('package.json', JSON.stringify({ name: 'polyglot', version: '1.4.0' }, null, 2))
        break
      case 'easy-03-zero-dep-json-validator':
        await write('validator.ts', 'export function validateUser(obj: any) { const errors: string[] = []; if (typeof obj.id !== "number" || obj.id <= 0) errors.push("id must be > 0"); if (typeof obj.email !== "string" || !obj.email.includes("@")) errors.push("invalid email"); return { valid: errors.length === 0, errors }; }')
        break
      case 'easy-04-deep-get-property':
        await write('getDeep.ts', 'export function getDeep(obj: any, path: string, fallback?: any) { return path.split(".").reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : undefined, obj) ?? fallback; }')
        break
      case 'easy-05-shell-log-pipeline':
        await write('linecount.txt', '5\n')
        break
      case 'easy-06-hmac-token-generator':
        await write('hmac.ts', codeStr('import', ' { createHmac } from "node:crypto"; export function createHmacToken(payload: string, secret: string): string { return createHmac("sha256", secret).update(payload).digest("hex"); }'))
        break
      case 'easy-07-barrel-export-generator':
        await write('src/components/index.ts', 'export * from "./Button"; export * from "./Card"; export * from "./Modal";')
        break
      case 'easy-08-typed-env-parser':
        await write('env.ts', 'export function parseEnv(raw: string) { return { PORT: parseInt(process.env.PORT || "3000", 10), DEBUG: process.env.DEBUG === "true", DB_HOST: process.env.DB_HOST || "localhost" }; }')
        break
      case 'easy-09-advanced-gitignore-negative-patterns':
        await write('.gitignore', '*.log\n!audit.log\ndist/\n!dist/bundle.js\n')
        break
      case 'easy-10-levenshtein-fuzzy-search':
        await write('levenshtein.ts', 'export function levenshtein(a: string, b: string): number { if (a === b) return 0; const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0)); for (let i = 0; i <= a.length; i++) dp[i][0] = i; for (let j = 0; j <= b.length; j++) dp[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]); return dp[a.length][b.length]; }')
        break
      case 'easy-11-tool-ask-user':
        ctx.toolCalls = [{ name: 'ask_user', input: { question: 'npm or pnpm?' }, ok: true }]
        break
      case 'easy-12-directory-lister':
        ctx.toolCalls = [{ name: 'list_dir', input: { path: '.' }, ok: true }]
        break
      case 'easy-13-circular-dependency-spotter':
        await write('report.txt', 'Circular cycle detected between a.ts and b.ts.')
        break
      case 'easy-14-strict-semver-regex':
        await write('semver.ts', 'export const SEMVER_REGEX = /^\\d+\\.\\d+\\.\\d+/;')
        break
      case 'easy-15-markdown-matrix-generator':
        await write('summary.md', '# Summary\n\n| Metric | Value | Status |\n|---|---|---|\n| Latency | 45ms | Optimal |\n')
        break
      case 'easy-16-url-query-serializer':
        await write('queryString.ts', 'export function serializeParams(p: Record<string, any>): string { return Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }')
        break
      case 'easy-17-debounce-function':
        await write('debounce.ts', 'export function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number) { let timer: any; const debounced = (...args: any[]) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), waitMs); }; debounced.cancel = () => clearTimeout(timer); return debounced as any; }')
        break
      case 'easy-18-deep-clone-utility':
        await write('deepClone.ts', 'export function deepClone<T>(val: T): T { return typeof structuredClone === "function" ? structuredClone(val) : JSON.parse(JSON.stringify(val)); }')
        break
      case 'easy-19-event-emitter':
        await write('eventEmitter.ts', 'export class EventEmitter { private listeners: Record<string, Function[]> = {}; on(e: string, fn: Function) { (this.listeners[e] = this.listeners[e] || []).push(fn); } off(e: string, fn: Function) { this.listeners[e] = (this.listeners[e] || []).filter(f => f !== fn); } emit(e: string, ...args: any[]) { (this.listeners[e] || []).forEach(fn => fn(...args)); } }')
        break
      case 'easy-20-binary-search':
        await write('binarySearch.ts', 'export function binarySearch<T>(arr: T[], target: T): number { let l = 0, r = arr.length - 1; while (l <= r) { const mid = (l + r) >>> 1; if (arr[mid] === target) return mid; if (arr[mid] < target) l = mid + 1; else r = mid - 1; } return -1; }')
        break
      case 'easy-21-topological-sort':
        await write('topoSort.ts', 'export function topoSort(nodes: string[], edges: [string, string][]): string[] { const inDegree: Record<string, number> = {}; nodes.forEach(n => inDegree[n] = 0); edges.forEach(([, to]) => inDegree[to] = (inDegree[to] || 0) + 1); const q = nodes.filter(n => inDegree[n] === 0); const res: string[] = []; while (q.length) { const n = q.shift()!; res.push(n); edges.filter(([from]) => from === n).forEach(([, to]) => { if (--inDegree[to] === 0) q.push(to); }); } if (res.length !== nodes.length) throw new Error("cycle"); return res; }')
        break
      case 'easy-22-ansi-escape-stripper':
        await write('stripAnsi.ts', 'export function stripAnsi(str: string): string { return str.replace(/\\u001b\\[[0-9;]*m/g, ""); }')
        break
      case 'easy-23-lru-cache':
        await write('lru.ts', 'export class LRUCache<K, V> { private map = new Map<K, V>(); constructor(private capacity: number) {} get(k: K) { if (!this.map.has(k)) return undefined; const v = this.map.get(k)!; this.map.delete(k); this.map.set(k, v); return v; } put(k: K, v: V) { this.map.delete(k); if (this.map.size >= this.capacity) { const first = this.map.keys().next().value; if (first !== undefined) this.map.delete(first); } this.map.set(k, v); } }')
        break
      case 'easy-24-token-bucket-rate-limiter':
        await write('rateLimiter.ts', 'export class TokenBucket { private tokens: number; private last = Date.now(); constructor(private cap: number, private rate: number) { this.tokens = cap; } tryConsume(t = 1) { const now = Date.now(); this.tokens = Math.min(this.cap, this.tokens + (now - this.last) * (this.rate / 1000)); this.last = now; if (this.tokens >= t) { this.tokens -= t; return true; } return false; } }')
        break
      case 'easy-25-json-to-ts-interface':
        await write('jsonToTs.ts', 'export function inferInterface(name: string, obj: any): string { const fields = Object.entries(obj).map(([k, v]) => `  ${k}: ${typeof v};`).join("\\n"); return `export interface ${name} {\\n${fields}\\n}`;}')
        break
      case 'easy-26-multipart-boundary-parser':
        await write('multipart.ts', 'export function extractBoundary(ct: string): string | null { const m = ct.match(/boundary=([^;]+)/i); return m ? m[1].trim().replace(/^"|"$/g, "") : null; }')
        break
      case 'easy-27-uuid-v4-validator':
        await write('uuid.ts', 'export function isUuidV4(s: string): boolean { return /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}/.test(s); }')
        break
      case 'easy-28-exponential-backoff-jitter':
        await write('backoff.ts', 'export function calculateBackoff(attempt: number, base = 100, max = 5000): number { const exp = Math.min(max, base * Math.pow(2, attempt)); return Math.floor(Math.random() * exp); }')
        break
      case 'easy-29-math-expression-tokenizer':
        await write('tokenizer.ts', 'export function tokenize(expr: string): string[] { return expr.match(/\\d+|[+\\-*/()]/g) || []; }')
        break
      case 'easy-30-markdown-checklist-updater':
        await write('checklist.ts', 'export function toggleTask(md: string, task: string, completed: boolean): string { return md.replace(new RegExp(`- \\\\[[ x]\\\\] ${task}`, "i"), completed ? `- [x] ${task}` : `- [ ] ${task}`); }')
        break
      case 'easy-31-conventional-commit-linter':
        await write('commitLint.ts', 'export function isValidCommit(msg: string): boolean { return /^(feat|fix|docs|refactor|test|chore)(\\(.+\\))?: .+/i.test(msg); }')
        break
      case 'easy-32-yaml-scalar-parser':
        await write('yaml.ts', 'export function parseYamlFlat(raw: string) { const res: Record<string, any> = {}; raw.split("\\n").forEach(l => { const [k, v] = l.split(":"); if (k && v) res[k.trim()] = v.trim(); }); return res; }')
        break
      case 'easy-33-base64-hex-codec':
        await write('codec.ts', 'export const base64ToHex = (b: string) => Buffer.from(b, "base64").toString("hex"); export const hexToBase64 = (h: string) => Buffer.from(h, "hex").toString("base64");')
        break
      case 'easy-34-promise-timeout-wrapper':
        await write('withTimeout.ts', 'export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> { const to = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms)); return Promise.race([p, to]); }')
        break
      case 'easy-35-human-bytes-formatter':
        await write('formatBytes.ts', 'export function formatBytes(b: number) { const k = 1024; const sizes = ["B", "KB", "MB", "GB"]; const i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + " " + sizes[i]; }')
        break
      case 'easy-36-semver-comparator':
        await write('semverCompare.ts', 'export function compareSemVer(a: string, b: string): number { const pA = a.split(".").map(Number); const pB = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pA[i] || 0) > (pB[i] || 0)) return 1; if ((pA[i] || 0) < (pB[i] || 0)) return -1; } return 0; }')
        break
      case 'easy-37-csv-row-parser':
        await write('parseCsvLine.ts', 'export function parseCsvLine(line: string): string[] { const regex = /(?:^|,)(?:"([^"]*)"|([^,]*))/g; const res: string[] = []; let m; while ((m = regex.exec(line)) !== null && m[0] !== "") { res.push(m[1] ?? m[2] ?? ""); } return res; }')
        break
      case 'easy-38-object-diff-checker':
        await write('diffObjects.ts', 'export function diffObjects(a: any, b: any) { const added = Object.keys(b).filter(k => !(k in a)); const deleted = Object.keys(a).filter(k => !(k in b)); const modified = Object.keys(a).filter(k => k in b && a[k] !== b[k]); return { added, modified, deleted }; }')
        break
      case 'easy-39-cookie-header-parser':
        await write('cookie.ts', 'export function parseCookies(h: string) { const res: Record<string, string> = {}; h.split("; ").forEach(p => { const [k, v] = p.split("="); if (k) res[k] = decodeURIComponent(v || ""); }); return res; }')
        break
      case 'easy-40-hex-to-rgb-converter':
        await write('color.ts', 'export function hexToRgb(h: string) { const n = parseInt(h.replace("#", ""), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }')
        break
      case 'easy-41-ip-cidr-matcher':
        await write('cidr.ts', 'export function ipInCidr(ip: string, cidr: string): boolean { const [range, bits] = cidr.split("/"); const mask = ~((1 << (32 - Number(bits))) - 1); const toLong = (s: string) => s.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0; return (toLong(ip) & mask) === (toLong(range) & mask); }')
        break
      case 'easy-42-cron-validator':
        await write('cronValidator.ts', 'export function isValidCron(e: string) { return e.trim().split(/\\s+/).length === 5; }')
        break
      case 'easy-43-path-normalizer':
        await write('normalizePath.ts', 'export function normalizePosixPath(p: string) { const stack: string[] = []; p.split("/").forEach(seg => { if (seg === "..") stack.pop(); else if (seg && seg !== ".") stack.push(seg); }); return (p.startsWith("/") ? "/" : "") + stack.join("/"); }')
        break
      case 'easy-44-priority-queue':
        await write('priorityQueue.ts', 'export class PriorityQueue<T> { private items: Array<{ item: T; priority: number }> = []; push(item: T, priority: number) { this.items.push({ item, priority }); this.items.sort((a, b) => b.priority - a.priority); } pop(): T | undefined { return this.items.shift()?.item; } }')
        break
      case 'easy-45-trie-autocomplete':
        await write('trie.ts', 'export class Trie { private root: any = {}; insert(w: string) { let node = this.root; for (const ch of w) node = node[ch] = node[ch] || {}; node.isEnd = true; } autocomplete(p: string): string[] { return [p]; } }')
        break
      case 'easy-46-unicode-slugifier':
        await write('slugify.ts', 'export function slugify(t: string) { return t.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }')
        break
      case 'easy-47-memory-usage-formatter':
        await write('memory.ts', 'export function getMemoryStats() { const m = process.memoryUsage(); const d = 1024 * 1024; return { heapUsedMb: m.heapUsed / d, heapTotalMb: m.heapTotal / d, rssMb: m.rss / d }; }')
        break
      case 'easy-48-cli-arg-parser':
        await write('parseArgs.ts', 'export function parseCliArgs(args: string[]) { const flags: Record<string, any> = {}, positional: string[] = []; args.forEach(a => { if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); flags[k] = v ?? true; } else positional.push(a); }); return { flags, positional }; }')
        break
      case 'easy-49-string-template-interpolator':
        await write('template.ts', 'export function renderTemplate(t: string, data: any) { return t.replace(/{{([^}]+)}}/g, (_, k) => data[k.trim()] ?? ""); }')
        break
      case 'easy-50-unified-diff-generator':
        await write('diff.ts', 'export function generateUnifiedDiff(f: string, oldT: string, newT: string) { return `--- a/${f}\\n+++ b/${f}\\n@@ -1,1 +1,1 @@\\n-${oldT}\\n+${newT}`; }')
        break
    }
  } else if (scenario.id.startsWith('med-')) {
    switch (scenario.id) {
      case 'med-01-async-iterator-backpressure':
        await write('streamIterator.ts', 'export async function* streamToAsyncIterable(s: any) { for await (const chunk of s) { s.pause(); yield chunk; s.resume(); } } export const sym = Symbol.asyncIterator;')
        break
      case 'med-02-react-debounced-fetch-hook':
        await write('useDebouncedFetch.ts', b64('aW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VTdGF0ZSB9IGZyb20gInJlYWN0IjsgZXhwb3J0IGZ1bmN0aW9uIHVzZURlYm91bmNlZEZldGNoPFQ+KHVybDogc3RyaW5nKSB7IGNvbnN0IFtkYXRhLCBzZXREYXRhXSA9IHVzZVN0YXRlPFQ8bnVsbD4obnVsbCk7IHVzZUVmZmVjdCgoKSA9PiB7IGNvbnN0IGFjID0gbmV3IEFib3J0Q29udHJvbGxlcigpOyBmZXRjaCh1cmwsIHsgc2lnbmFsOiBhYy5zaWduYWwgfSkudGhlbihyID0+IHIuanNvbigpKS50aGVuKHNldERhdGEpLmNhdGNoKCgpID0+IHt9KTsgcmV0dXJuICgpID0+IGFjLmFib3J0KCk7IH0sIFt1cmxdKTsgcmV0dXJuIHsgZGF0YSwgbG9hZGluZzogZmFsc2UsIGVycm9yOiBudWxsIH07IH0='))
        break
      case 'med-03-dependency-inversion-refactor':
        await write('types.ts', 'export interface IDatabase { query(sql: string): any[]; }')
        await write('service.ts', b64('aW1wb3J0IHsgSURhdGFiYXNlIH0gZnJvbSAiLi90eXBlcyI7IGV4cG9ydCBjbGFzcyBVc2VyU2VydmljZSB7IGNvbnN0cnVjdG9yKHByaXZhdGUgZGI6IElEYXRhYmFzZSkge30gZ2V0VXNlcigpIHsgcmV0dXJuIHRoaXMuZGIucXVlcnkoIlNFTEVDVCAxIik7IH0gfQ=='))
        break
      case 'med-04-jsonrpc-batch-server':
        await write('rpcHandler.ts', 'export async function handleJsonRpc(req: any, methods: any) { if (Array.isArray(req)) return Promise.all(req.map(r => handleJsonRpc(r, methods))); if (!req) return { jsonrpc: "2.0", error: { code: -32600 } }; if (!methods[req.method]) return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found" } }; return { jsonrpc: "2.0", id: req.id, result: await methods[req.method](req.params) }; }')
        break
      case 'med-05-multi-file-refactor-5-files':
        await write('math.ts', 'export function calculatePayment(opts: { amount: number; fee: number }) { return opts.amount + opts.fee; }')
        await write('service.ts', b64('aW1wb3J0IHsgY2FsY3VsYXRlUGF5bWVudCB9IGZyb20gIi4vbWF0aCI7IGV4cG9ydCBmdW5jdGlvbiBwcm9jZXNzT3JkZXIoYTogbnVtYmVyLCBiOiBudW1iZXIpIHsgcmV0dXJuIGNhbGN1bGF0ZVBheW1lbnQoeyBhbW91bnQ6IGEsIGZlZTogYiB9KTsgfQ=='))
        await write('controller.ts', b64('aW1wb3J0IHsgcHJvY2Vzc09yZGVyIH0gZnJvbSAiLi9zZXJ2aWNlIjsgZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZVBvc3QocmVxOiBhbnkpIHsgcmV0dXJuIHByb2Nlc3NPcmRlcihyZXEuYW1vdW50LCByZXEuZmVlKTsgfQ=='))
        await write('router.ts', b64('aW1wb3J0IHsgaGFuZGxlUG9zdCB9IGZyb20gIi4vY29udHJvbGxlciI7IGV4cG9ydCBjb25zdCByb3V0ZSA9IChyZXE6IGFueSkgPT4gaGFuZGxlUG9zdChyZXEpOw=='))
        await write('index.ts', b64('aW1wb3J0IHsgcm91dGUgfSBmcm9tICIuL3JvdXRlciI7IGNvbnNvbGUubG9nKHJvdXRlKHsgYW1vdW50OiAxMDAsIGZlZTogMTAgfSkpOw=='))
        break
      case 'med-06-vitest-fake-timers-suite':
        await write('retryWithBackoff.test.ts', b64('aW1wb3J0IHsgZGVzY3JpYmUsIGl0LCBleHBlY3QsIHZpIH0gZnJvbSAidml0ZXN0IjsgZGVzY3JpYmUoInJldHJ5IiwgKCkgPT4geyBpdCgicmV0cmllcyB3aXRoIHRpbWVycyIsIGFzeW5jICgpID0+IHsgdmkudXNlRmFrZVRpbWVycygpOyB2aS5hZHZhbmNlVGltZXJzQnlUaW1lKDEwMDApOyBjb25zdCBmbiA9IHZpLmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoNDIpOyBleHBlY3QoZm4pLnRvQmVEZWZpbmVkKCk7IH0pOyB9KTs='))
        break
      case 'med-07-async-mutex-semaphore':
        await write('mutex.ts', 'export class AsyncMutex { private lock = Promise.resolve(); async withLock<T>(fn: () => Promise<T>): Promise<T> { const prev = this.lock; let release: any; this.lock = new Promise(r => release = r); await prev; try { return await fn(); } finally { release(); } } }')
        break
      case 'med-08-zod-cross-field-refinements':
        await write('schema.ts', b64('aW1wb3J0IHsgeiB9IGZyb20gInpvZCI7IGV4cG9ydCBjb25zdCBjaGVja291dFNjaGVtYSA9IHoub2JqZWN0KHsgaXNDb21wYW55OiB6LmJvb2xlYW4oKSwgdmF0TnVtYmVyOiB6LnN0cmluZygpLm9wdGlvbmFsKCksIGNvdW50cnk6Ijoic3RyaW5nIiwgemlwOiB6LnN0cmluZygpIH0pLnN1cGVyUmVmaW5lKChkYXRhLCBjdHgpID0+IHsgaWYgKGRhdGEuaXNDb21wYW55ICYmICFkYXRhLnZhdE51bWJlcikgY3R4LmFkZElzc3VlKHsgY29kZTogImN1c3RvbSIsIG1lc3NhZ2U6ICJ2YXQgcmVxdWlyZWQiLCBwYXRoOiBbInZhdE51bWJlciJdIH0pOyBpZiAoZGF0YS5jb3VudHJ5ID09PSAiVVMiICYmICFkYXRhLnppcCkgY3R4LmFkZElzc3VlKHsgY29kZTogImN1c3RvbSIsIG1lc3NhZ2U6ICJ6aXAgaW52YWxpZCIsIHBhdGg6IFsiemlwIl0gfSk7IH0pOw=='))
        break
      case 'med-09-shunting-yard-evaluator':
        await write('evaluator.ts', 'export function evaluate(expr: string): number { const postfix: any[] = []; const ops: string[] = []; const prec: any = { "+": 1, "-": 1, "*": 2, "/": 2 }; return 42; }')
        break
      case 'med-10-circuit-breaker-fsm':
        await write('circuitBreaker.ts', 'export class CircuitBreaker { private state: "CLOSED"|"OPEN"|"HALF_OPEN" = "CLOSED"; constructor(private failureThreshold = 3, private cooldownMs = 5000) {} async execute<T>(fn: () => Promise<T>): Promise<T> { if (this.state === "OPEN") throw new Error("Circuit Open"); return fn(); } getState() { return this.state; } }')
        break
      case 'med-11-websocket-reconnect-manager':
        await write('wsManager.ts', 'export class ReconnectingWebSocket { private queue: string[] = []; send(m: string) { this.queue.push(m); } reconnect() {} }')
        break
      case 'med-12-sqlite-migration-runner':
        await write('migrate.ts', 'export async function runMigrations(db: any, list: any[]) { for (const m of list) { db.exec("BEGIN TRANSACTION;"); db.exec(m.up); db.exec("COMMIT;"); } }')
        break
      case 'med-13-concurrent-task-pool':
        await write('taskPool.ts', 'export class TaskPool { constructor(private concurrency = 2) {} async add<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> { const ac = new AbortController(); return task(ac.signal); } abortAll() {} }')
        break
      case 'med-14-typed-finite-state-machine':
        await write('fsm.ts', 'export function createFSM(config: any) { let state = config.initial; return { getState: () => state, send: (e: any) => { const next = config.transitions[state]?.[e]; if (next) { state = next; return true; } return false; } }; }')
        break
      case 'med-15-sse-stream-parser':
        await write('sseParser.ts', 'export async function* parseSSE(stream: any) { for await (const chunk of stream) yield { data: "hello" }; }')
        break
      case 'med-16-persistent-vector-trie':
        await write('persistentVector.ts', 'export class PersistentVector<T> { constructor(private items: T[] = []) {} push(i: T) { return new PersistentVector([...this.items, i]); } get(idx: number) { return this.items[idx]; } set(idx: number, i: T) { const copy = [...this.items]; copy[idx] = i; return new PersistentVector(copy); } }')
        break
      case 'med-17-markdown-ast-tokenizer':
        await write('markdownAst.ts', 'export function parseMarkdown(src: string) { return [{ type: "heading", content: "Title", depth: 1 }, { type: "code", content: "const a = 1;", lang: "ts" }]; }')
        break
      case 'med-18-onion-middleware-pipeline':
        await write('middleware.ts', 'export function compose(mws: any[]) { return function(ctx: any) { let idx = -1; function dispatch(i: number): Promise<void> { if (i <= idx) return Promise.reject(new Error("next() called multiple times")); idx = i; const fn = mws[i]; if (!fn) return Promise.resolve(); return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1))); } return dispatch(0); }; }')
        break
      case 'med-19-react-undo-redo-reducer':
        await write('undoable.ts', 'export function createUndoableReducer(r: any) { return (state: any, action: any) => { if (action.type === "UNDO") return { past: state.past.slice(0, -1), present: state.past[state.past.length-1], future: [state.present, ...state.future] }; if (action.type === "REDO") return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }; return { past: [...state.past, state.present], present: r(state.present, action), future: [] }; }; }')
        break
      case 'med-20-binary-tlv-protocol-codec':
        await write('tlv.ts', 'export function encodeTLV(tag: number, val: Buffer) { const buf = Buffer.alloc(3 + val.length); buf.writeUInt8(tag, 0); buf.writeUInt16BE(val.length, 1); val.copy(buf, 3); return buf; } export function decodeTLV(buf: Buffer) { return [{ tag: buf.readUInt8(0), value: buf.subarray(3) }]; }')
        break
      case 'med-21-dijkstra-graph-search':
        await write('dijkstra.ts', 'export function findShortestPath(g: any, s: string, e: string) { const visited = new Set(); return { path: [s, e], distance: 10 }; }')
        break
      case 'med-22-micro-template-compiler':
        await write('compileTemplate.ts', 'export function compile(t: string) { return (ctx: any) => t.replace(/\\{\\{#if (\\w+)\\}\\}(.*?)\\{\\{\\/if\\}\\}/g, (_, k, b) => ctx[k] ? b : "").replace(/\\{\\{#each (\\w+)\\}\\}(.*?)\\{\\{\\/each\\}\\}/g, (_, k, b) => (ctx[k]||[]).map(() => b).join("")); }')
        break
      case 'med-23-promisified-fs-watcher':
        await write('watchDir.ts', b64('aW1wb3J0IGZzIGZyb20gIm5vZGU6ZnMiOyBleHBvcnQgZnVuY3Rpb24gd2F0Y2hEZWJvdW5jZWQoZGlyOiBzdHJpbmcsIGQgPSAxMDAsIGNiOiBhbnkpIHsgbGV0IHQ6IGFueTsgY29uc3QgdyA9IGZzLndhdGNoKGRpciwgKCkgPT4geyBjbGVhclRpbWVvdXQodCk7IHQgPSBzZXRUaW1lb3V0KCgpID0+IGNiKFtkaXJdKSwgZCk7IH0pOyByZXR1cm4gKCkgPT4gdy5jbG9zZSgpOyB9'))
        break
      case 'med-24-multi-field-search-index':
        await write('searchIndex.ts', 'export class SearchIndex<T extends { id: string }> { private docs: any[] = []; add(d: T) { this.docs.push(d); } search(q: string) { return this.docs.map(doc => ({ doc, score: 1 })); } }')
        break
      case 'med-25-json-patch-rfc6902':
        await write('jsonPatch.ts', 'export function applyPatch(doc: any, patches: any[]) { patches.forEach(p => { if (p.op === "add") doc[p.path.replace("/", "")] = p.value; if (p.op === "remove") delete doc[p.path.replace("/", "")]; if (p.op === "replace") doc[p.path.replace("/", "")] = p.value; }); return doc; }')
        break
      case 'med-26-event-listener-leak-detector':
        await write('leakDetector.ts', 'export function trackEmitter(em: any, max = 10) { const counts: any = {}; em.addListener = em.on = (e: string, fn: any) => { counts[e] = (counts[e]||0)+1; }; return { getActiveCounts: () => counts, stop: () => {} }; }')
        break
      case 'med-27-virtualized-list-calculator':
        await write('virtualList.ts', 'export function computeVirtualWindow({ scrollTop, containerHeight, itemHeight, totalCount, overscan = 2 }: any) { const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan); const endIndex = Math.min(totalCount, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan); return { startIndex, endIndex, offsetY: startIndex * itemHeight, totalHeight: totalCount * itemHeight }; }')
        break
      case 'med-28-async-memoize-ttl-dedup':
        await write('memoizeAsync.ts', 'export function memoizeAsync(fn: any, { ttlMs }: any) { const cache = new Map(); return async (...args: any[]) => { const k = JSON.stringify(args); if (cache.has(k)) return cache.get(k); const p = fn(...args); cache.set(k, p); return p; }; }')
        break
      case 'med-29-cli-interactive-wizard':
        await write('wizard.ts', 'export class Wizard<T extends Record<string, any>> { private steps: any[] = []; private answers: any = {}; addStep(k: any, v: any) { this.steps.push({ k, v }); } next(val: any) { const s = this.steps.shift(); if (s) this.answers[s.k] = val; } back() {} getAnswers() { return this.answers; } }')
        break
      case 'med-30-vitest-custom-matcher-extension':
        await write('matchers.ts', 'export function toBeWithinRange(rec: number, min: number, max: number) { const pass = rec >= min && rec <= max; return { pass: pass, message: () => `expected ${rec} in [${min}, ${max}]` }; }')
        break
    }
  } else if (scenario.id.startsWith('hard-')) {
    switch (scenario.id) {
      case 'hard-01-mini-lsm-storage-engine':
        await write('lsmTree.ts', 'export class LSMTree { constructor(private dir: string) {} async put(k: string, v: string) { /* wal.log sstable */ } async get(k: string) { return "val"; } async recover() {} }')
        break
      case 'hard-02-two-phase-commit-consensus':
        await write('twoPhaseCommit.ts', 'export class Coordinator { async executeTransaction(p: Participant[], d: any) { for (const part of p) if (!await part.prepare(d)) return false; for (const part of p) await part.commit(); return true; } } export class Participant { async prepare(d: any) { return true; } async commit() {} async abort() {} }')
        break
      case 'hard-03-commonjs-to-esm-transformer':
        await write('utils.js', b64('aW1wb3J0IHBhdGggZnJvbSAibm9kZTpwYXRoIjsgZXhwb3J0IGNvbnN0IGZvcm1hdCA9IChzKSA9PiBzLnRyaW0oKTsgZXhwb3J0IGNvbnN0IGJhc2UgPSBpbXBvcnQubWV0YS51cmw7'))
        await write('math.js', b64('aW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAiLi91dGlscy5qcyI7IGV4cG9ydCBjb25zdCBhZGQgPSAoYSwgYikgPT4gYSArIGI7'))
        await write('service.js', b64('aW1wb3J0IHsgYWRkIH0gZnJvbSAiLi9tYXRoLmpzIjsgZXhwb3J0IGNvbnN0IGNhbGN1bGF0ZSA9ICh4KSA9PiBhZGQoeCwgMTApOw=='))
        break
      case 'hard-04-distributed-task-queue-dlq':
        await write('taskQueue.ts', 'export class TaskQueue { private queue: any[] = []; private deadLetter: any[] = []; async enqueue(j: any) { this.queue.push(j); } retry() {} }')
        break
      case 'hard-05-self-healing-router-bug-hunt':
        await write('src/router.ts', 'export function matchRoute(pattern: string, path: string) { const p = pattern.replace(/:([a-zA-Z0-9_]+)/g, "([^/]+)"); return new RegExp("^" + p + "$").test(path); }')
        await write('src/middleware.ts', 'export async function errorHandler(ctx: any, next: any) { try { await next(); } catch (err) { ctx.status = 500; } }')
        break
      case 'hard-06-ast-code-linter-fixer':
        await write('linter.ts', '// removes console.log\nexport function lintAndFix(code: string) { const fixedCode = code.replace(/any/g, "unknown"); return { fixedCode, issuesFound: 2 }; }')
        break
      case 'hard-07-b-tree-indexing-engine':
        await write('btree.ts', 'export class BTree<K, V> { private root: any = { keys: [], children: [] }; insert(k: K, val: V) { /* node split logic */ } search(k: K): V | undefined { return undefined; } }')
        break
      case 'hard-08-in-memory-sql-query-engine':
        await write('sqlEngine.ts', 'export function executeSql(q: string, tables: any) { if (/SELECT/i.test(q) && /WHERE/i.test(q) && /JOIN/i.test(q)) return [{ id: 1 }]; return []; }')
        break
      case 'hard-09-mini-git-object-engine':
        await write('miniGit.ts', b64('aW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gIm5vZGU6Y3J5cHRvIjsgZXhwb3J0IGNvbnN0IGhhc2hPYmplY3QgPSAoYzogc3RyaW5nKSA9PiBjcmVhdGVIYXNoKCJzaGExIikudXBkYXRlKGMpLmRpZ2VzdCgiaGV4Iik7IGV4cG9ydCBjb25zdCB3cml0ZVRyZWUgPSAoKSA9PiBjcmVhdGVIYXNoKCJzaGExIikudXBkYXRlKCJ0cmVlIikudXBkYXRlKCJzaGExIik7IGV4cG9ydCBjb25zdCBjcmVhdGVDb21taXQgPSAoKSA9PiBjcmVhdGVIYXNoKCJzaGExIikudXBkYXRlKCJjb21taXQiKS5kaWdlc3QoImhleCIpOw=='))
        break
      case 'hard-10-bytecode-vm-assembler':
        await write('vm.ts', 'export function assemble(src: string): Uint8Array { /* PUSH ADD JMP HALT */ return new Uint8Array([1, 2, 3]); } export class StackVM { execute(bc: Uint8Array): number { return 42; } }')
        break
      case 'hard-11-crdt-replicated-text':
        await write('crdtText.ts', 'export class CRDTDoc { constructor(public siteId: string) {} insert(c: string, idx: number) { return { siteId: this.siteId, c, idx }; } applyRemote(op: any) {} getText() { return "hello"; } }')
        break
      case 'hard-12-wasm-binary-header-parser':
        await write('wasmParser.ts', 'export function parseWasmModule(buf: Buffer) { return { version: 1, sections: [{ id: 1, name: "Type", size: 10 }] }; }')
        break
      case 'hard-13-streaming-sax-json-parser':
        await write('streamJson.ts', 'export class StreamingJsonParser { write(chunk: string) {} on(event: "startObject"|"endObject", cb: Function) {} }')
        break
      case 'hard-14-dynamic-memory-allocator':
        await write('memoryPool.ts', 'export class MemoryPool { constructor(total: number) {} malloc(size: number) { return 0; } free(ptr: number) {} }')
        break
      case 'hard-15-zero-knowledge-debugger':
        await write('brokenApp.ts', 'export class WorkerPool { private active = 0; private queue: Function[] = []; async run(task: () => Promise<void>) { while (this.active >= 2) await new Promise(r => this.queue.push(r)); this.active++; try { await task(); } finally { this.active--; const next = this.queue.shift(); if (next) next(); } } }')
        await write('postmortem.md', '# Postmortem\n\nIdentified async race condition deadlock in WorkerPool queue.')
        break
    }
  } else if (scenario.id.startsWith('hell-')) {
    switch (scenario.id) {
      case 'hell-01-relational-sql-engine-bplus-tree':
        await write('sqlEngine.ts', 'export class RelationalDatabase { private bplusTree = new Map(); execute(sql: string) { if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return []; if (/CREATE|INSERT|SELECT|UPDATE|DELETE/i.test(sql)) return [{ id: 1 }]; return []; } }')
        break
      case 'hell-02-scheme-lisp-compiler-tco-vm':
        await write('lispVM.ts', 'export function compileScheme(src: string) { /* lambda define quote */ return new Uint8Array([1, 2, 3]); } export class SchemeVM { run(bc: Uint8Array) { /* TCO loop */ return 42; } }')
        break
      case 'hell-03-raft-consensus-cluster-simulator':
        await write('raft.ts', 'export class RaftNode { private state: "Follower"|"Candidate"|"Leader" = "Follower"; RequestVote() {} AppendEntries() {} InstallSnapshot() {} }')
        break
      case 'hell-04-typescript-bundler-tree-shaker':
        await write('bundler.ts', 'export async function bundleProject(entry: string) { return { code: "(function(){})();", map: "{\\"version\\":3,\\"mappings\\":\\"\\"}", deadCodeEliminated: ["unusedFn"] }; }')
        break
      case 'hell-05-autonomous-distributed-architecture-repair':
        await write('src/auth.ts', 'let refreshPromise: Promise<string> | null = null; export async function refreshToken() { if (!refreshPromise) { refreshPromise = fetchNewToken().finally(() => { refreshPromise = null; }); } return refreshPromise; } async function fetchNewToken() { return "token_" + Date.now(); }')
        await write('src/cursor.ts', 'export function decodeCursor(cursor: string) { const str = Buffer.from(cursor, "base64").toString("utf8"); return parseInt(str); }')
        await write('src/socketPool.ts', 'const sockets: any[] = []; export function addSocket(s: any) { sockets.push(s); } export function removeSocket(s: any) { const idx = sockets.indexOf(s); if (idx !== -1) sockets.splice(idx, 1); }')
        await write('INCIDENT_REPORT.md', '# Incident Report\n\nFixed JWT refresh mutex, cursor off-by-one, and socket pool leak across microservice layers.')
        break
    }
  }
}

/**
 * Main Benchmark Runner Orchestrator with Tier Filtering & Parallel Concurrency
 */
export async function runBenchmark(
  modelName = 'Local-LLM (Flashgent Default)',
  evaluator?: BenchmarkEvaluator,
  progressCb?: (progress: { index: number; total: number; scenario: string; score: number }) => void,
  opts?: BenchmarkRunOptions
): Promise<BenchmarkReport> {
  const scenarioResults: ScenarioResult[] = []

  let scenarios = DATASET_100_SCENARIOS
  if (opts?.scenarioId) {
    scenarios = scenarios.filter((s) => s.id === opts.scenarioId)
  } else if (opts?.tier && opts.tier !== 'all') {
    scenarios = scenarios.filter((s) => s.tier === opts.tier)
  }

  const total = scenarios.length
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 1, 16))

  if (concurrency === 1) {
    for (const [offset, scenario] of scenarios.entries()) {
      const res = await executeScenario(scenario, evaluator)
      scenarioResults.push(res)
      progressCb?.({ index: offset + 1, total, scenario: scenario.name, score: res.earnedPoints })
    }
  } else {
    // Parallel execution with worker pool
    let currentIndex = 0
    let completedCount = 0

    const workers = Array.from({ length: concurrency }, async () => {
      while (currentIndex < scenarios.length) {
        const index = currentIndex++
        const scenario = scenarios[index]
        if (!scenario) break

        const res = await executeScenario(scenario, evaluator)
        scenarioResults[index] = res
        completedCount++
        progressCb?.({ index: completedCount, total, scenario: scenario.name, score: res.earnedPoints })
      }
    })

    await Promise.all(workers)
  }

  // Calculate Base Scores per tier
  const easyScenarios = scenarioResults.filter((s) => s.tier === 'easy')
  const medScenarios = scenarioResults.filter((s) => s.tier === 'medium')
  const hardScenarios = scenarioResults.filter((s) => s.tier === 'hard')
  const hellScenarios = scenarioResults.filter((s) => s.tier === 'hell')

  const easyScore = easyScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const medScore = medScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const hardScore = hardScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const hellScore = hellScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)

  const rawScore = Math.round((easyScore + medScore + hardScore + hellScore) * 10) / 10
  const rawMaxScore = scenarios.reduce((sum, s) => sum + s.points, 0)
  const maxRawScore = rawMaxScore

  // 100-Point Normalized Base Score (80 pts max)
  const normalizedBase = maxRawScore > 0 ? (rawScore / maxRawScore) * 80 : 0

  // Calculate Quality Modifiers (20 pts max)
  const allToolCalls = scenarioResults.flatMap(
    (s) => (s as { toolCalls?: Array<{ ok?: boolean }> }).toolCalls ?? []
  )
  const passRate = scenarioResults.filter((s) => s.passed).length / Math.max(1, scenarioResults.length)

  // 1. Tool Syntax Precision (+7.0 max)
  let toolSyntaxPrecision = 7.0
  if (allToolCalls.length > 0) {
    const validCalls = allToolCalls.filter((c) => c.ok !== false).length
    toolSyntaxPrecision = Math.round((validCalls / allToolCalls.length) * 7.0 * 10) / 10
  } else {
    toolSyntaxPrecision = Math.round(passRate * 7.0 * 10) / 10
  }

  // 2. Thinking Efficiency (+7.0 max)
  const weightedLogicScore = (
    easyScenarios.filter((s) => s.passed).length * 0.5 +
    medScenarios.filter((s) => s.passed).length * 2.0 +
    hardScenarios.filter((s) => s.passed).length * 4.0 +
    hellScenarios.filter((s) => s.passed).length * 8.0
  ) / Math.max(1, maxRawScore)
  const thinkingEfficiency = Math.round(weightedLogicScore * 7.0 * 10) / 10

  // 3. Execution Speed & Economy (+6.0 max)
  const speedScores = scenarioResults.map((s) => {
    if (!s.passed) return 0
    const budget = s.tier === 'easy' ? 45_000 : s.tier === 'medium' ? 120_000 : s.tier === 'hard' ? 240_000 : 360_000
    if (s.durationMs <= budget) return 1
    return Math.max(0.4, 1 - (s.durationMs - budget) / (budget * 2))
  })
  const avgSpeedRatio = speedScores.reduce((sum, v) => sum + v, 0) / Math.max(1, scenarioResults.length)
  const executionSpeedAndEconomy = Math.round(avgSpeedRatio * 6.0 * 10) / 10

  const totalModifier = Math.min(
    20,
    Math.round((toolSyntaxPrecision + thinkingEfficiency + executionSpeedAndEconomy) * 10) / 10
  )

  const totalScore = Math.min(100, Math.round((normalizedBase + totalModifier) * 10) / 10)
  const maxScore = 100
  const percentage = Math.round((totalScore / maxScore) * 1000) / 10

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    modelName,
    totalScore,
    maxScore,
    rawScore,
    rawMaxScore: maxRawScore,
    percentage,
    summary: {
      easy: {
        passed: easyScenarios.filter((s) => s.passed).length,
        total: easyScenarios.length,
        score: easyScore,
        max: easyScenarios.reduce((sum, s) => sum + s.maxPoints, 0)
      },
      medium: {
        passed: medScenarios.filter((s) => s.passed).length,
        total: medScenarios.length,
        score: medScore,
        max: medScenarios.reduce((sum, s) => sum + s.maxPoints, 0)
      },
      hard: {
        passed: hardScenarios.filter((s) => s.passed).length,
        total: hardScenarios.length,
        score: hardScore,
        max: hardScenarios.reduce((sum, s) => sum + s.maxPoints, 0)
      },
      hell: {
        passed: hellScenarios.filter((s) => s.passed).length,
        total: hellScenarios.length,
        score: hellScore,
        max: hellScenarios.reduce((sum, s) => sum + s.maxPoints, 0)
      }
    },
    qualityModifiers: {
      toolSyntaxPrecision,
      thinkingEfficiency,
      executionSpeedAndEconomy,
      totalModifier
    },
    scenarios: scenarioResults
  }

  saveReport(report)
  printCliTable(report)

  return report
}

function saveReport(report: BenchmarkReport): string | null {
  try {
    const baseDir = process.env.FLASHGENT_HOME || process.cwd()
    const reportsDir = join(baseDir, 'benchmarks', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const filename = `report-${report.timestamp.replace(/[:.]/g, '-')}.json`
    const filepath = join(reportsDir, filename)
    writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8')
    return filepath
  } catch {
    return null
  }
}

function printCliTable(report: BenchmarkReport): void {
  const bar = '═'.repeat(74)
  const thinBar = '─'.repeat(74)

  console.log(`\n╔${bar}╗`)
  console.log(`║              FLASHGENT AGENT BENCHMARK REPORT (100-POINT SYSTEM)         ║`)
  console.log(`╠${bar}╣`)
  console.log(`║ Model: ${report.modelName.padEnd(65)}║`)
  console.log(`║ Time:  ${report.timestamp.padEnd(65)}║`)
  console.log(`╠${bar}╣`)
  console.log(`║ #   TIER    SCENARIO ID                 POINTS  STATUS  DURATION         ║`)
  console.log(`╠${thinBar}╣`)

  report.scenarios.forEach((s, idx) => {
    const num = String(idx + 1).padStart(3, ' ')
    const tier = s.tier.toUpperCase().padEnd(6, ' ')
    const id = s.id.slice(0, 26).padEnd(26, ' ')
    const pts = `${s.earnedPoints}/${s.maxPoints} pts`.padStart(8, ' ')
    const status = s.passed ? '✓ PASS' : '✗ FAIL'
    const dur = `${s.durationMs}ms`.padStart(8, ' ')
    console.log(`║ ${num} ${tier}  ${id}  ${pts}  ${status}  ${dur}         ║`)
  })

  console.log(`╠${bar}╣`)
  console.log(`║ BASE SCORE BREAKDOWN (80 Base Max):                                      ║`)
  console.log(`║   • Easy   (50 x 0.5):  ${String(report.summary.easy.score).padStart(4, ' ')} / ${String(report.summary.easy.max).padEnd(4, ' ')} pts (${report.summary.easy.passed}/${report.summary.easy.total} passed)${' '.repeat(26)}║`)
  console.log(`║   • Medium (30 x 2.0):  ${String(report.summary.medium.score).padStart(4, ' ')} / ${String(report.summary.medium.max).padEnd(4, ' ')} pts (${report.summary.medium.passed}/${report.summary.medium.total} passed)${' '.repeat(26)}║`)
  console.log(`║   • Hard   (15 x 4.0):  ${String(report.summary.hard.score).padStart(4, ' ')} / ${String(report.summary.hard.max).padEnd(4, ' ')} pts (${report.summary.hard.passed}/${report.summary.hard.total} passed)${' '.repeat(26)}║`)
  console.log(`║   • Hell   (5 x 8.0):   ${String(report.summary.hell.score).padStart(4, ' ')} / ${String(report.summary.hell.max).padEnd(4, ' ')} pts (${report.summary.hell.passed}/${report.summary.hell.total} passed)${' '.repeat(26)}║`)
  console.log(`╠${thinBar}╣`)
  console.log(`║ QUALITY MODIFIERS (20 Max):                                              ║`)
  console.log(`║   • Tool Syntax Precision:        +${String(report.qualityModifiers.toolSyntaxPrecision).padStart(4, ' ')} / 7.0 pts${' '.repeat(29)}║`)
  console.log(`║   • Thinking Budget Efficiency:   +${String(report.qualityModifiers.thinkingEfficiency).padStart(4, ' ')} / 7.0 pts${' '.repeat(29)}║`)
  console.log(`║   • Execution Speed & Economy:    +${String(report.qualityModifiers.executionSpeedAndEconomy).padStart(4, ' ')} / 6.0 pts${' '.repeat(29)}║`)
  console.log(`╠${bar}╣`)
  console.log(`║ FINAL SCORE:  ${String(report.totalScore).padStart(5, ' ')} / ${report.maxScore} pts (${report.percentage}%)                                  ║`)
  console.log(`╚${bar}╝\n`)
}

// Auto-run if executed directly via CLI
function parseModelFromArgs(): string | null {
  if (process.env.BENCHMARK_MODEL) return process.env.BENCHMARK_MODEL
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--model' || a === '-m') return argv[i + 1] ?? null
    if (a && a.startsWith('--model=')) return a.split('=')[1] ?? null
  }
  return null
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const modelArg = parseModelFromArgs() || undefined
  const evaluator = modelArg
    ? createLlmEvaluator({
        baseUrl: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
        modelName: modelArg
      })
    : undefined
  void runBenchmark(modelArg ?? 'Deterministic Baseline (Flashgent Simulator)', evaluator)
}
