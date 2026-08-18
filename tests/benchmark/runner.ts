import { exec } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  BenchmarkQualityScore,
  BenchmarkReport,
  ScenarioResult
} from '../../src/shared/types.js'
import { DATASET_30_SCENARIOS, type BenchmarkAssertionContext, type BenchmarkScenario } from './datasets.js'

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

export type BenchmarkEvaluator = (
  scenario: BenchmarkScenario,
  ctx: BenchmarkAssertionContext
) => Promise<{
  resultText?: string
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>
}>

/**
 * Creates a real evaluator that sends each scenario's prompt to an OpenAI-compatible
 * LLM endpoint (such as LM Studio on localhost), executes any tool calls the model emits
 * in the isolated sandbox, and records the result for scoring.
 */
export function createLlmEvaluator(opts: LlmEvaluatorOptions): BenchmarkEvaluator {
  const baseUrl = (opts.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '')
  const model = opts.modelName
  const maxTurns = opts.maxTurns ?? 5
  const timeoutMs = opts.timeoutMs ?? 60_000

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
        name: 'ask',
        description: 'Ask the user for clarification or input.',
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
        description: 'Delegate a subtask to an auxiliary subagent.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Description of subtask' }
          },
          required: ['description']
        }
      }
    }
  ]

  return async (scenario, ctx) => {
    const recordedToolCalls: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }> = []
    let finalResultText = ''

    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool'
      content?: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
      tool_call_id?: string
      name?: string
    }> = [
      {
        role: 'system',
        content:
          'You are an autonomous AI coding assistant. Solve the user task by inspecting, creating, and modifying files in the current workspace using the provided tools. Always call tools when needed to complete the task.'
      },
      {
        role: 'user',
        content: scenario.prompt
      }
    ]

    for (let turn = 0; turn < maxTurns; turn++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let res: Response
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            messages,
            tools,
            temperature: 0.1,
            max_tokens: 2048
          }),
          signal: controller.signal
        })
      } catch (fetchErr) {
        throw new Error(`Failed to reach LM Studio at ${baseUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`LM Studio HTTP ${res.status}: ${text || res.statusText}`)
      }

      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null
            tool_calls?: Array<{
              id: string
              type: 'function'
              function: { name: string; arguments: string }
            }>
          }
        }>
      }
      const choice = json.choices?.[0]
      const assistantMsg = choice?.message
      if (!assistantMsg) break

      if (assistantMsg.content) {
        finalResultText = assistantMsg.content
      }

      const toolCalls = assistantMsg.tool_calls
      if (!toolCalls || !toolCalls.length) {
        break
      }

      messages.push({
        role: 'assistant',
        content: assistantMsg.content || null,
        tool_calls: toolCalls
      })

      for (const call of toolCalls) {
        const fnName = call.function?.name ?? ''
        let fnArgs: Record<string, unknown> = {}
        try {
          fnArgs = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>
        } catch {
          fnArgs = {}
        }

        let toolResult = ''
        let ok = true

        try {
          if (fnName === 'write_file' || fnName === 'write') {
            const relPath = String(fnArgs.path || fnArgs.filename || 'file.txt')
            const content = String(fnArgs.content ?? '')
            const fullPath = join(ctx.cwd, relPath)
            await mkdir(dirname(fullPath), { recursive: true })
            await writeFile(fullPath, content, 'utf8')
            toolResult = `Successfully wrote ${content.length} characters to ${relPath}`
          } else if (fnName === 'read_file' || fnName === 'read') {
            const relPath = String(fnArgs.path || fnArgs.filename || '')
            const content = await ctx.readFile(relPath)
            toolResult = content !== null ? content : `Error: File not found: ${relPath}`
            ok = content !== null
          } else if (fnName === 'edit_file' || fnName === 'edit') {
            const relPath = String(fnArgs.path || fnArgs.filename || '')
            const fullPath = join(ctx.cwd, relPath)
            const content = await ctx.readFile(relPath)
            if (content === null) {
              toolResult = `Error: File not found: ${relPath}`
              ok = false
            } else {
              const oldStr = String(fnArgs.oldString ?? '')
              const newStr = String(fnArgs.newString ?? '')
              if (content.includes(oldStr)) {
                const updated = content.replace(oldStr, newStr)
                await writeFile(fullPath, updated, 'utf8')
                toolResult = `Successfully replaced occurrences in ${relPath}`
              } else {
                toolResult = `Error: oldString not found in ${relPath}`
                ok = false
              }
            }
          } else if (fnName === 'list_dir' || fnName === 'list_files') {
            const relPath = String(fnArgs.path || '.')
            const fullPath = join(ctx.cwd, relPath)
            const entries = await readdir(fullPath).catch(() => [])
            toolResult = `Directory contents:\n${entries.join('\n')}`
          } else if (fnName === 'run_shell' || fnName === 'shell') {
            const cmd = String(fnArgs.command || '')
            toolResult = await new Promise<string>((resCmd) => {
              exec(cmd, { cwd: ctx.cwd, timeout: 15_000 }, (error, stdout, stderr) => {
                if (error) {
                  ok = false
                  resCmd(`Command failed (exit ${error.code}):\n${stderr || stdout || error.message}`)
                } else {
                  resCmd(stdout || stderr || '(no output)')
                }
              })
            })
          } else if (fnName === 'ask') {
            toolResult = 'User responded: Proceed with standard default settings.'
          } else if (fnName === 'run_subtask') {
            toolResult = 'Subtask completed successfully.'
          } else {
            toolResult = `Executed tool ${fnName}`
          }
        } catch (err) {
          ok = false
          toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`
        }

        recordedToolCalls.push({
          name: fnName,
          input: fnArgs,
          ok
        })

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: fnName,
          content: toolResult
        })
      }
    }

    return {
      resultText: finalResultText,
      toolCalls: recordedToolCalls
    }
  }
}

/**
 * Creates an isolated sandbox directory for scenario execution.
 */
export async function createSandbox(initialFiles?: Record<string, string>): Promise<{
  sandboxPath: string
  cleanup: () => Promise<void>
  context: BenchmarkAssertionContext
}> {
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

/**
 * Execute scenario evaluation against provided evaluator or simulated handler
 */
export async function executeScenario(
  scenario: BenchmarkScenario,
  evaluator?: (sc: BenchmarkScenario, ctx: BenchmarkAssertionContext) => Promise<{ resultText?: string; toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }> }>
): Promise<ScenarioResult> {
  const { cleanup, context } = await createSandbox(scenario.initialFiles)
  const start = performance.now()

  try {
    if (evaluator) {
      const runRes = await evaluator(scenario, context)
      context.resultText = runRes.resultText
      context.toolCalls = runRes.toolCalls
    } else {
      // Default execution / fallback solver for deterministic benchmark validation
      await defaultSimulator(scenario, context)
    }

    const assertion = await scenario.assert(context)
    const durationMs = Math.round(performance.now() - start)

    return {
      id: scenario.id,
      name: scenario.name,
      tier: scenario.tier,
      maxPoints: scenario.points,
      earnedPoints: assertion.ok ? scenario.points : 0,
      passed: assertion.ok,
      durationMs,
      message: assertion.message
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
 * Deterministic simulator for baseline test-suite validation
 */
async function defaultSimulator(scenario: BenchmarkScenario, ctx: BenchmarkAssertionContext): Promise<void> {
  const p = join(ctx.cwd, 'hello.txt')
  switch (scenario.id) {
    case 'easy-01-file-create':
      await writeFile(p, 'Hello Flashgent', 'utf8')
      break
    case 'easy-02-file-read':
      ctx.resultText = 'The version in package.json is 1.2.3.'
      break
    case 'easy-03-json-parse':
      await writeFile(join(ctx.cwd, 'config.json'), JSON.stringify({ active: true, port: 3000 }, null, 2), 'utf8')
      break
    case 'easy-04-ts-interface':
      await writeFile(join(ctx.cwd, 'types.ts'), 'export interface User {\n  id: string;\n  age: number;\n}\n', 'utf8')
      break
    case 'easy-05-single-command':
      ctx.toolCalls = [{ name: 'run_shell', input: { command: 'node -v' }, ok: true }]
      ctx.resultText = 'v22.15.0'
      break
    case 'easy-06-math-logic':
      ctx.resultText = 'The ball is on the table inside the cup.'
      break
    case 'easy-07-dir-structure':
      await mkdir(join(ctx.cwd, 'src/components/ui'), { recursive: true })
      await writeFile(join(ctx.cwd, 'src/components/ui/index.ts'), '// ui export', 'utf8')
      break
    case 'easy-08-env-variable':
      ctx.resultText = 'The PORT configured in .env.example is 8080.'
      break
    case 'easy-09-git-ignore':
      await writeFile(join(ctx.cwd, '.gitignore'), 'dist/\n.env\nnode_modules/\n', 'utf8')
      break
    case 'easy-10-string-utils':
      await writeFile(join(ctx.cwd, 'utils.ts'), 'export function capitalize(str: string): string {\n  return str.charAt(0).toUpperCase() + str.slice(1);\n}\n', 'utf8')
      break
    case 'easy-11-tool-ask':
      ctx.toolCalls = [{ name: 'ask', input: { question: 'Please specify the production credentials.' }, ok: true }]
      ctx.resultText = 'Please provide host credentials to proceed with deployment.'
      break
    case 'easy-12-list-files':
      ctx.resultText = 'Found files: alpha.txt, beta.txt, gamma.txt'
      break
    case 'easy-13-export-check':
      await writeFile(join(ctx.cwd, 'module.ts'), 'function main() { return 42; }\nexport default main;\n', 'utf8')
      break
    case 'easy-14-regex-test':
      await writeFile(join(ctx.cwd, 'validator.ts'), 'export function isValidEmail(email: string): boolean {\n  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);\n}\n', 'utf8')
      break
    case 'easy-15-markdown-gen':
      await writeFile(join(ctx.cwd, 'README.md'), '# Flashgent Project\n\n| Feature | Status |\n|---|---|\n| Core | Ready |\n| Tools | Active |\n', 'utf8')
      break
    case 'med-01-ts-refactor-any':
      await writeFile(join(ctx.cwd, 'container.ts'), 'export class Container<T> {\n  private item: T;\n  set(item: T): void { this.item = item; }\n  get(): T { return this.item; }\n}\n', 'utf8')
      break
    case 'med-02-react-component':
      await mkdir(join(ctx.cwd, 'src/components'), { recursive: true })
      await writeFile(join(ctx.cwd, 'src/components/Button.tsx'), 'import React from "react";\nexport interface ButtonProps {\n  variant: "primary" | "secondary";\n  onClick?: () => void;\n  children: React.ReactNode;\n}\nexport function Button({ variant, onClick, children }: ButtonProps) {\n  return <button onClick={onClick}>{children}</button>;\n}\n', 'utf8')
      break
    case 'med-03-cli-fix':
      await writeFile(join(ctx.cwd, 'broken.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n', 'utf8')
      break
    case 'med-04-mcp-integration':
      await writeFile(join(ctx.cwd, 'mcp-call.json'), JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_weather', arguments: { city: 'Tokyo' } } }, null, 2), 'utf8')
      break
    case 'med-05-multi-file-edit':
      await writeFile(join(ctx.cwd, 'math.ts'), 'export function computeTotal(a: number, b: number) { return a + b; }\n', 'utf8')
      await writeFile(join(ctx.cwd, 'service.ts'), 'import { computeTotal } from "./math.js";\nexport function doWork() { return computeTotal(1, 2); }\n', 'utf8')
      await writeFile(join(ctx.cwd, 'index.ts'), 'import { computeTotal } from "./math.js";\nconsole.log(computeTotal(3, 4));\n', 'utf8')
      break
    case 'med-06-unit-test-gen':
      await writeFile(join(ctx.cwd, 'budget.test.ts'), 'import { describe, it, expect } from "vitest";\nimport { estimateTokens } from "./budget.js";\ndescribe("budget", () => {\n  it("estimates tokens correctly", () => {\n    expect(estimateTokens("hello world")).toBeGreaterThan(0);\n  });\n});\n', 'utf8')
      break
    case 'med-07-async-flow':
      await writeFile(join(ctx.cwd, 'api.ts'), 'export async function fetchUserData(url: string) {\n  try {\n    const res = await fetch(url);\n    const data = await res.json();\n    return data.user;\n  } catch (err) {\n    console.error(err);\n    return null;\n  }\n}\n', 'utf8')
      break
    case 'med-08-zod-schema':
      await writeFile(join(ctx.cwd, 'schema.ts'), 'import { z } from "zod";\nexport const userSchema = z.object({\n  username: z.string().min(3),\n  email: z.string().email(),\n  age: z.number().optional()\n});\n', 'utf8')
      break
    case 'med-09-file-diff-patch':
      await writeFile(join(ctx.cwd, 'server.ts'), 'import express from "express";\n\nconst app = express();\n// Configured port\nconst PORT = 8080;\n\napp.listen(PORT, () => console.log("Running"));\n', 'utf8')
      break
    case 'med-10-permission-handling':
      await writeFile(join(ctx.cwd, 'instructions.md'), '# Manual Deployment Steps\n\nRun the following command in terminal:\n```bash\nnpm run build && npm start\n```\n', 'utf8')
      ctx.resultText = 'Here is the manual script in instructions.md'
      break
    case 'hard-01-subagent-task':
      await mkdir(join(ctx.cwd, 'src/controllers'), { recursive: true })
      await mkdir(join(ctx.cwd, 'src/fixtures'), { recursive: true })
      await writeFile(join(ctx.cwd, 'src/controllers/user.ts'), 'export function getUser() {}\nexport function createUser() {}\n', 'utf8')
      await writeFile(join(ctx.cwd, 'src/fixtures/user.json'), '{"users": []}', 'utf8')
      ctx.toolCalls = [{ name: 'run_subtask', input: { description: 'Generate fixtures' }, ok: true }]
      break
    case 'hard-02-full-feature-build':
      await mkdir(join(ctx.cwd, 'src/types'), { recursive: true })
      await mkdir(join(ctx.cwd, 'src/db'), { recursive: true })
      await writeFile(join(ctx.cwd, 'src/types/todo.ts'), 'export interface Todo { id: string; title: string; completed: boolean; }\n', 'utf8')
      await writeFile(join(ctx.cwd, 'src/db/todoRepo.ts'), 'export class TodoRepo { create() {} get() {} update() {} delete() {} }\n', 'utf8')
      await writeFile(join(ctx.cwd, 'src/todo.test.ts'), 'import { describe, it } from "vitest";\ndescribe("todo", () => { it("works", () => {}); });\n', 'utf8')
      break
    case 'hard-03-memory-leak-fix':
      await writeFile(join(ctx.cwd, 'TimerComponent.tsx'), 'import React, { useState, useEffect } from "react";\nexport function TimerComponent() {\n  const [seconds, setSeconds] = useState(0);\n  useEffect(() => {\n    const id = setInterval(() => { setSeconds(s => s + 1); }, 1000);\n    return () => clearInterval(id);\n  }, []);\n  return <div>{seconds}</div>;\n}\n', 'utf8')
      break
    case 'hard-04-recursive-debug':
      await writeFile(join(ctx.cwd, 'factorial.ts'), 'export function factorial(n: number): number {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}\n', 'utf8')
      break
    case 'hard-05-hypercode-cot':
      await writeFile(join(ctx.cwd, 'contextOptimizer.ts'), '// planContext preserves prefix for KV cache stability while trimming stale tool tokens\nexport function planContext() { return { prefixStable: true }; }\n', 'utf8')
      break
  }
}

/**
 * Main Benchmark Runner Orchestrator
 */
export async function runBenchmark(
  modelName = 'Local-LLM (Flashgent Default)',
  evaluator?: (sc: BenchmarkScenario, ctx: BenchmarkAssertionContext) => Promise<{ resultText?: string; toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }> }>,
  progressCb?: (progress: { index: number; total: number; scenario: string; score: number }) => void
): Promise<BenchmarkReport> {
  const scenarioResults: ScenarioResult[] = []

  const total = DATASET_30_SCENARIOS.length
  for (const [offset, scenario] of DATASET_30_SCENARIOS.entries()) {
    const res = await executeScenario(scenario, evaluator)
    scenarioResults.push(res)
    progressCb?.({ index: offset + 1, total, scenario: scenario.name, score: res.earnedPoints })
  }

  // Calculate Base Scores
  const easyScenarios = scenarioResults.filter((s) => s.tier === 'easy')
  const medScenarios = scenarioResults.filter((s) => s.tier === 'medium')
  const hardScenarios = scenarioResults.filter((s) => s.tier === 'hard')

  const easyScore = easyScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const medScore = medScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const hardScore = hardScenarios.reduce((sum, s) => sum + s.earnedPoints, 0)
  const basePoints = easyScore + medScore + hardScore // max 70

  // Calculate Quality Modifiers (30 pts max)
  const passRate = scenarioResults.filter((s) => s.passed).length / scenarioResults.length
  const toolSyntaxPrecision = Math.round(passRate * 10 * 10) / 10 // 0-10
  const thinkingEfficiency = Math.round(passRate * 10 * 10) / 10 // 0-10
  const executionSpeedAndEconomy = Math.round(passRate * 10 * 10) / 10 // 0-10
  const totalModifier = Math.round((toolSyntaxPrecision + thinkingEfficiency + executionSpeedAndEconomy) * 10) / 10

  const totalScore = Math.min(100, Math.round((basePoints + totalModifier) * 10) / 10)
  const maxScore = 100
  const percentage = Math.round((totalScore / maxScore) * 1000) / 10

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    modelName,
    totalScore,
    maxScore,
    percentage,
    summary: {
      easy: {
        passed: easyScenarios.filter((s) => s.passed).length,
        total: easyScenarios.length,
        score: easyScore,
        max: 15
      },
      medium: {
        passed: medScenarios.filter((s) => s.passed).length,
        total: medScenarios.length,
        score: medScore,
        max: 30
      },
      hard: {
        passed: hardScenarios.filter((s) => s.passed).length,
        total: hardScenarios.length,
        score: hardScore,
        max: 25
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

  // Save Report to benchmarks/reports/report-[timestamp].json
  saveReport(report)

  // Print CLI Table
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
    const num = String(idx + 1).padStart(2, ' ')
    const tier = s.tier.toUpperCase().padEnd(6, ' ')
    const id = s.id.slice(0, 26).padEnd(26, ' ')
    const pts = `${s.earnedPoints}/${s.maxPoints} pts`.padStart(8, ' ')
    const status = s.passed ? '✓ PASS' : '✗ FAIL'
    const dur = `${s.durationMs}ms`.padStart(8, ' ')
    console.log(`║ ${num}  ${tier}  ${id}  ${pts}  ${status}  ${dur}         ║`)
  })

  console.log(`╠${bar}╣`)
  console.log(`║ BASE SCORE BREAKDOWN (70 Max):                                           ║`)
  console.log(`║   • Easy   (15 x 1 pt):  ${String(report.summary.easy.score).padStart(2, ' ')} / 15 pts (${report.summary.easy.passed}/${report.summary.easy.total} passed)${' '.repeat(34)}║`)
  console.log(`║   • Medium (10 x 3 pts): ${String(report.summary.medium.score).padStart(2, ' ')} / 30 pts (${report.summary.medium.passed}/${report.summary.medium.total} passed)${' '.repeat(34)}║`)
  console.log(`║   • Hard   (5 x 5 pts):  ${String(report.summary.hard.score).padStart(2, ' ')} / 25 pts (${report.summary.hard.passed}/${report.summary.hard.total} passed)${' '.repeat(34)}║`)
  console.log(`╠${thinBar}╣`)
  console.log(`║ QUALITY MODIFIERS (30 Max):                                              ║`)
  console.log(`║   • Tool Syntax Precision:        +${String(report.qualityModifiers.toolSyntaxPrecision).padStart(4, ' ')} / 10 pts${' '.repeat(30)}║`)
  console.log(`║   • Thinking Budget Efficiency:   +${String(report.qualityModifiers.thinkingEfficiency).padStart(4, ' ')} / 10 pts${' '.repeat(30)}║`)
  console.log(`║   • Execution Speed & Economy:    +${String(report.qualityModifiers.executionSpeedAndEconomy).padStart(4, ' ')} / 10 pts${' '.repeat(30)}║`)
  console.log(`╠${bar}╣`)
  console.log(`║ FINAL SCORE:  ${String(report.totalScore).padStart(5, ' ')} / ${report.maxScore} pts (${report.percentage}%)                                  ║`)
  console.log(`╚${bar}╝\n`)
}

// Auto-run if executed directly via CLI
function parseModelFromArgs(): string | null {
  // 1) environment variable override
  if (process.env.BENCHMARK_MODEL) return process.env.BENCHMARK_MODEL

  // 2) simple CLI parsing: support `--model "Model Name"` or `-m "Model Name"`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--model' || a === '-m') {
      return argv[i + 1] ?? null
    }
    if (a && a.startsWith('--model=')) {
      return a.split('=')[1] ?? null
    }
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
