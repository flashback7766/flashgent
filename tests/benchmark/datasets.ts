/**
 * Flashgent Benchmark Suite: 30 Scenarios for Local Agent Evaluation
 * 
 * Point distribution:
 * - Easy: 15 tasks x 1 pt = 15 pts
 * - Medium: 10 tasks x 3 pts = 30 pts
 * - Hard: 5 tasks x 5 pts = 25 pts
 * Base total = 70 pts
 * Quality modifiers = 30 pts (Tool syntax 10 + Thinking efficiency 10 + Token economy 10)
 * Max total = 100 pts
 */

export type ScenarioTier = 'easy' | 'medium' | 'hard'

export interface BenchmarkAssertionContext {
  cwd: string
  resultText?: string
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>
  readFile: (relPath: string) => Promise<string | null>
  fileExists: (relPath: string) => Promise<boolean>
}

export interface BenchmarkScenario {
  id: string
  name: string
  tier: ScenarioTier
  points: number
  description: string
  prompt: string
  initialFiles?: Record<string, string>
  assert: (ctx: BenchmarkAssertionContext) => Promise<{ ok: boolean; message?: string }>
}

export const DATASET_30_SCENARIOS: BenchmarkScenario[] = [
  // =========================================================================
  // EASY (15 tasks x 1 pt = 15 pts)
  // =========================================================================
  {
    id: 'easy-01-file-create',
    name: 'Create hello.txt',
    tier: 'easy',
    points: 1,
    description: 'Create hello.txt containing "Hello Flashgent"',
    prompt: 'Create a file named hello.txt in the workspace containing exactly "Hello Flashgent".',
    assert: async (ctx) => {
      const content = await ctx.readFile('hello.txt')
      if (!content) return { ok: false, message: 'hello.txt was not created' }
      const ok = content.trim() === 'Hello Flashgent'
      return { ok, message: ok ? undefined : `Expected "Hello Flashgent", got: "${content.trim()}"` }
    }
  },
  {
    id: 'easy-02-file-read',
    name: 'Read package.json version',
    tier: 'easy',
    points: 1,
    description: 'Read package.json and extract project version',
    prompt: 'Read package.json and tell me what the version field is.',
    initialFiles: {
      'package.json': JSON.stringify({ name: 'test-app', version: '1.2.3' }, null, 2)
    },
    assert: async (ctx) => {
      const ok = Boolean(ctx.resultText && /1\.2\.3/.test(ctx.resultText))
      return { ok, message: ok ? undefined : 'Agent response did not mention version 1.2.3' }
    }
  },
  {
    id: 'easy-03-json-parse',
    name: 'Create valid config.json',
    tier: 'easy',
    points: 1,
    description: 'Create config.json with active: true and port: 3000',
    prompt: 'Create config.json with valid JSON: { "active": true, "port": 3000 }.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('config.json')
      if (!raw) return { ok: false, message: 'config.json was not created' }
      try {
        const parsed = JSON.parse(raw)
        const ok = parsed.active === true && parsed.port === 3000
        return { ok, message: ok ? undefined : `JSON values incorrect: ${raw}` }
      } catch (e) {
        return { ok: false, message: `Invalid JSON syntax: ${String(e)}` }
      }
    }
  },
  {
    id: 'easy-04-ts-interface',
    name: 'TypeScript User interface',
    tier: 'easy',
    points: 1,
    description: 'Create types.ts with User interface (id: string, age: number)',
    prompt: 'Create types.ts and export a User interface with fields id: string and age: number.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('types.ts')
      if (!raw) return { ok: false, message: 'types.ts was not created' }
      const hasInterface = /interface\s+User/.test(raw)
      const hasId = /id\s*:\s*string/.test(raw)
      const hasAge = /age\s*:\s*number/.test(raw)
      const ok = hasInterface && hasId && hasAge
      return { ok, message: ok ? undefined : `Missing required fields in types.ts: ${raw}` }
    }
  },
  {
    id: 'easy-05-single-command',
    name: 'Execute shell command',
    tier: 'easy',
    points: 1,
    description: 'Run node -v via run_shell tool',
    prompt: 'Execute node -v in the shell and return the output version.',
    assert: async (ctx) => {
      const calledShell = ctx.toolCalls?.some((c) => c.name === 'run_shell' && /node\s+-v/i.test(String(c.input.command)))
      const hasNodeVersion = Boolean(ctx.resultText && /v\d+\.\d+/i.test(ctx.resultText))
      const ok = Boolean(calledShell || hasNodeVersion)
      return { ok, message: ok ? undefined : 'Did not call run_shell with node -v' }
    }
  },
  {
    id: 'easy-06-math-logic',
    name: 'Spatial logic riddle',
    tier: 'easy',
    points: 1,
    description: 'Solve inverted cup riddle',
    prompt: 'If you place a ball on a table and cover it with an upside-down cup, then turn the cup right-side up while keeping it on the table, where is the ball?',
    assert: async (ctx) => {
      const text = ctx.resultText?.toLowerCase() ?? ''
      const ok = text.includes('cup') || text.includes('table') || text.includes('inside')
      return { ok, message: ok ? undefined : 'Incomplete spatial reasoning response' }
    }
  },
  {
    id: 'easy-07-dir-structure',
    name: 'Directory creation',
    tier: 'easy',
    points: 1,
    description: 'Create directory src/components/ui/ with index.ts',
    prompt: 'Create the directory path src/components/ui/ and create an empty index.ts file inside it.',
    assert: async (ctx) => {
      const ok = await ctx.fileExists('src/components/ui/index.ts')
      return { ok, message: ok ? undefined : 'src/components/ui/index.ts does not exist' }
    }
  },
  {
    id: 'easy-08-env-variable',
    name: 'Read .env.example',
    tier: 'easy',
    points: 1,
    description: 'Read PORT value from .env.example',
    prompt: 'Read .env.example and report the value of PORT.',
    initialFiles: {
      '.env.example': 'PORT=8080\nAPI_KEY=secret_123\n'
    },
    assert: async (ctx) => {
      const ok = Boolean(ctx.resultText && /8080/.test(ctx.resultText))
      return { ok, message: ok ? undefined : 'PORT value 8080 was not mentioned' }
    }
  },
  {
    id: 'easy-09-git-ignore',
    name: 'Update .gitignore',
    tier: 'easy',
    points: 1,
    description: 'Append node_modules/ to .gitignore',
    prompt: 'Add node_modules/ to the .gitignore file.',
    initialFiles: {
      '.gitignore': 'dist/\n.env\n'
    },
    assert: async (ctx) => {
      const content = await ctx.readFile('.gitignore')
      if (!content) return { ok: false, message: '.gitignore missing' }
      const ok = /node_modules\/?/.test(content)
      return { ok, message: ok ? undefined : 'node_modules was not added to .gitignore' }
    }
  },
  {
    id: 'easy-10-string-utils',
    name: 'Implement capitalize function',
    tier: 'easy',
    points: 1,
    description: 'Write capitalize(str: string): string in utils.ts',
    prompt: 'Write a TypeScript function capitalize(str: string): string in utils.ts that uppercases the first character.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('utils.ts')
      if (!raw) return { ok: false, message: 'utils.ts not created' }
      const ok = /function\s+capitalize|const\s+capitalize/.test(raw) && /toUpperCase|charAt|slice/.test(raw)
      return { ok, message: ok ? undefined : 'capitalize function implementation missing in utils.ts' }
    }
  },
  {
    id: 'easy-11-tool-ask',
    name: 'Ask for clarification tool',
    tier: 'easy',
    points: 1,
    description: 'Use ask tool when context is ambiguous',
    prompt: 'Deploy the application to the production server immediately. (Do not guess credentials, ask for them).',
    assert: async (ctx) => {
      const calledAsk = ctx.toolCalls?.some((c) => c.name === 'ask')
      const askedInProse = Boolean(ctx.resultText && /credentials|which server|host|password/i.test(ctx.resultText))
      const ok = Boolean(calledAsk || askedInProse)
      return { ok, message: ok ? undefined : 'Did not request clarification/credentials' }
    }
  },
  {
    id: 'easy-12-list-files',
    name: 'List directory files',
    tier: 'easy',
    points: 1,
    description: 'List files in workspace',
    prompt: 'List all files in the current workspace directory.',
    initialFiles: {
      'alpha.txt': 'A',
      'beta.txt': 'B',
      'gamma.txt': 'C'
    },
    assert: async (ctx) => {
      const hasAlpha = Boolean(ctx.resultText && /alpha\.txt/i.test(ctx.resultText))
      const hasBeta = Boolean(ctx.resultText && /beta\.txt/i.test(ctx.resultText))
      const ok = hasAlpha && hasBeta
      return { ok, message: ok ? undefined : 'Did not list directory files alpha.txt and beta.txt' }
    }
  },
  {
    id: 'easy-13-export-check',
    name: 'Add default export',
    tier: 'easy',
    points: 1,
    description: 'Add export default to module.ts',
    prompt: 'Edit module.ts to add export default main.',
    initialFiles: {
      'module.ts': 'function main() { return 42; }\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('module.ts')
      if (!raw) return { ok: false, message: 'module.ts missing' }
      const ok = /export\s+default\s+main|export\s+default\s+function/.test(raw)
      return { ok, message: ok ? undefined : 'export default not found in module.ts' }
    }
  },
  {
    id: 'easy-14-regex-test',
    name: 'Email validation regex',
    tier: 'easy',
    points: 1,
    description: 'Write email validator regex in validator.ts',
    prompt: 'Create validator.ts with an isValidEmail(email: string): boolean function using regex.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('validator.ts')
      if (!raw) return { ok: false, message: 'validator.ts missing' }
      const ok = /isValidEmail/.test(raw) && /@/.test(raw) && /\.test\(|\.match\(/.test(raw)
      return { ok, message: ok ? undefined : 'isValidEmail regex function missing' }
    }
  },
  {
    id: 'easy-15-markdown-gen',
    name: 'Generate README.md with table',
    tier: 'easy',
    points: 1,
    description: 'Create README.md with title and markdown table',
    prompt: 'Create README.md with a project title and a Markdown table comparing 2 features.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('README.md')
      if (!raw) return { ok: false, message: 'README.md not created' }
      const hasHeading = /#\s+.+/.test(raw)
      const hasTable = /\|.+\|.+\|/.test(raw) && /\|\s*[-:]+[-| :]*\|/.test(raw)
      const ok = hasHeading && hasTable
      return { ok, message: ok ? undefined : 'README.md missing heading or markdown table' }
    }
  },

  // =========================================================================
  // MEDIUM (10 tasks x 3 pts = 30 pts)
  // =========================================================================
  {
    id: 'med-01-ts-refactor-any',
    name: 'Refactor any to generic type',
    tier: 'medium',
    points: 3,
    description: 'Refactor container class in container.ts to remove any and use generic T',
    prompt: 'Refactor container.ts: replace any with a generic type parameter <T> so Container is type-safe.',
    initialFiles: {
      'container.ts': 'export class Container {\n  private item: any;\n  set(item: any): void { this.item = item; }\n  get(): any { return this.item; }\n}\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('container.ts')
      if (!raw) return { ok: false, message: 'container.ts missing' }
      const hasAny = /:\s*any\b/.test(raw)
      const hasGeneric = /class\s+Container<[A-Za-z0-9_]+>/.test(raw)
      const ok = !hasAny && hasGeneric
      return { ok, message: ok ? undefined : `container.ts still has any or lacks generic: ${raw}` }
    }
  },
  {
    id: 'med-02-react-component',
    name: 'Create Button.tsx component',
    tier: 'medium',
    points: 3,
    description: 'Create React Button.tsx with variant, onClick, children props',
    prompt: 'Create a React Button component in src/components/Button.tsx with TypeScript props interface ButtonProps supporting variant: "primary" | "secondary", onClick, and children.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('src/components/Button.tsx')
      if (!raw) return { ok: false, message: 'src/components/Button.tsx missing' }
      const hasProps = /ButtonProps/.test(raw) && /variant/.test(raw)
      const hasExport =
        /export\s+(default\s+)?(function|const)\s+Button/.test(raw) ||
        /export\s+default\s+Button\b/.test(raw) ||
        /export\s*\{\s*Button(\s+as\s+default)?\s*\}/.test(raw)
      const ok = hasProps && hasExport
      return { ok, message: ok ? undefined : 'Button.tsx does not export Button component with ButtonProps' }
    }
  },
  {
    id: 'med-03-cli-fix',
    name: 'Catch and fix syntax error',
    tier: 'medium',
    points: 3,
    description: 'Fix syntax error in broken.ts',
    prompt: 'Fix the syntax error in broken.ts so it is a valid TypeScript module.',
    initialFiles: {
      'broken.ts': 'export function add(a: number, b: number): number {\n  return a + b\n// Missing closing brace\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('broken.ts')
      if (!raw) return { ok: false, message: 'broken.ts missing' }
      const opens = (raw.match(/\{/g) || []).length
      const closes = (raw.match(/\}/g) || []).length
      const ok = opens > 0 && opens === closes
      return { ok, message: ok ? undefined : `broken.ts braces unbalanced: {=${opens}, }=${closes}` }
    }
  },
  {
    id: 'med-04-mcp-integration',
    name: 'Form JSON-RPC request',
    tier: 'medium',
    points: 3,
    description: 'Write mcp-call.json with valid JSON-RPC 2.0 tool call format',
    prompt: 'Create mcp-call.json with a valid JSON-RPC 2.0 request payload calling method "tools/call" with params { name: "get_weather", arguments: { city: "Tokyo" } }.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('mcp-call.json')
      if (!raw) return { ok: false, message: 'mcp-call.json missing' }
      try {
        const json = JSON.parse(raw)
        const ok = json.jsonrpc === '2.0' && json.method === 'tools/call' && json.params?.name === 'get_weather'
        return { ok, message: ok ? undefined : `Invalid MCP JSON-RPC format: ${raw}` }
      } catch (e) {
        return { ok: false, message: `JSON parse error: ${String(e)}` }
      }
    }
  },
  {
    id: 'med-05-multi-file-edit',
    name: 'Multi-file function rename',
    tier: 'medium',
    points: 3,
    description: 'Rename calculateSum to computeTotal across 3 files',
    prompt: 'Rename the function calculateSum to computeTotal across math.ts, service.ts, and index.ts simultaneously.',
    initialFiles: {
      'math.ts': 'export function calculateSum(a: number, b: number) { return a + b; }\n',
      'service.ts': 'import { calculateSum } from "./math.js";\nexport function doWork() { return calculateSum(1, 2); }\n',
      'index.ts': 'import { calculateSum } from "./math.js";\nconsole.log(calculateSum(3, 4));\n'
    },
    assert: async (ctx) => {
      const math = await ctx.readFile('math.ts')
      const service = await ctx.readFile('service.ts')
      const index = await ctx.readFile('index.ts')
      if (!math || !service || !index) return { ok: false, message: 'One or more files missing' }
      const hasOld = /calculateSum/.test(math) || /calculateSum/.test(service) || /calculateSum/.test(index)
      const hasNew = /computeTotal/.test(math) && /computeTotal/.test(service) && /computeTotal/.test(index)
      const ok = !hasOld && hasNew
      return { ok, message: ok ? undefined : 'calculateSum still present or computeTotal missing in some files' }
    }
  },
  {
    id: 'med-06-unit-test-gen',
    name: 'Generate Vitest unit test',
    tier: 'medium',
    points: 3,
    description: 'Write budget.test.ts testing estimateTokens function',
    prompt: 'Create budget.test.ts using Vitest (describe, it, expect) to test estimateTokens(text: string): number from ./budget.js.',
    initialFiles: {
      'budget.ts': 'export function estimateTokens(text: string): number { return Math.ceil(text.length / 3.5); }\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('budget.test.ts')
      if (!raw) return { ok: false, message: 'budget.test.ts missing' }
      const ok = /describe|it|test/.test(raw) && /expect/.test(raw) && /estimateTokens/.test(raw)
      return { ok, message: ok ? undefined : 'budget.test.ts lacks describe/it/expect/estimateTokens' }
    }
  },
  {
    id: 'med-07-async-flow',
    name: 'Refactor Promise chain to async/await',
    tier: 'medium',
    points: 3,
    description: 'Convert .then() callbacks to async/await with try/catch',
    prompt: 'Refactor fetchUserData in api.ts from .then() promise chain to modern async/await with try/catch.',
    initialFiles: {
      'api.ts': 'export function fetchUserData(url: string) {\n  return fetch(url).then(res => res.json()).then(data => data.user).catch(err => { console.error(err); return null; });\n}\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('api.ts')
      if (!raw) return { ok: false, message: 'api.ts missing' }
      const hasAsync = /async\s+function|async\s*\(/.test(raw)
      const hasAwait = /await\s+/.test(raw)
      const hasTryCatch = /try\s*\{[\s\S]*\}\s*catch/.test(raw)
      const ok = hasAsync && hasAwait && hasTryCatch
      return { ok, message: ok ? undefined : 'api.ts not refactored with async/await/try/catch' }
    }
  },
  {
    id: 'med-08-zod-schema',
    name: 'Zod validation schema',
    tier: 'medium',
    points: 3,
    description: 'Create userSchema in schema.ts with Zod validation',
    prompt: 'Create schema.ts exporting userSchema with z.object({ username: z.string().min(3), email: z.string().email(), age: z.number().optional() }).',
    assert: async (ctx) => {
      const raw = await ctx.readFile('schema.ts')
      if (!raw) return { ok: false, message: 'schema.ts missing' }
      const ok = /userSchema/.test(raw) && /z\.object/.test(raw) && /z\.string\(\)/.test(raw) && /email\(\)/.test(raw)
      return { ok, message: ok ? undefined : 'schema.ts lacks valid zod userSchema definition' }
    }
  },
  {
    id: 'med-09-file-diff-patch',
    name: 'Apply targeted diff patch',
    tier: 'medium',
    points: 3,
    description: 'Apply targeted patch using edit_file preserving formatting',
    prompt: 'In server.ts, change PORT from 3000 to 8080 and add a comment "// Configured port" above it, preserving all other indentation.',
    initialFiles: {
      'server.ts': 'import express from "express";\n\nconst app = express();\nconst PORT = 3000;\n\napp.listen(PORT, () => console.log("Running"));\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('server.ts')
      if (!raw) return { ok: false, message: 'server.ts missing' }
      const has8080 = /const\s+PORT\s*=\s*8080/.test(raw)
      const hasComment = /\/\/\s*Configured port/.test(raw)
      const ok = has8080 && hasComment
      return { ok, message: ok ? undefined : 'server.ts does not have updated PORT and comment' }
    }
  },
  {
    id: 'med-10-permission-handling',
    name: 'Handle permission denial gracefully',
    tier: 'medium',
    points: 3,
    description: 'Handle denial of write tool and propose alternative solution',
    prompt: 'I decline permission to execute shell commands directly. Please provide a manual script I can review and run myself instead in instructions.md.',
    assert: async (ctx) => {
      const instructions = await ctx.readFile('instructions.md')
      const inProse = Boolean(ctx.resultText && /bash|powershell|run|command|script/i.test(ctx.resultText))
      const ok = Boolean(instructions || inProse)
      return { ok, message: ok ? undefined : 'Did not provide alternative manual instructions' }
    }
  },

  // =========================================================================
  // HARD (5 tasks x 5 pts = 25 pts)
  // =========================================================================
  {
    id: 'hard-01-subagent-task',
    name: 'Subtask decomposition',
    tier: 'hard',
    points: 5,
    description: 'Generate API controller and delegate subtask investigation',
    prompt: 'Create an Express API controller in src/controllers/user.ts with getUser and createUser, and use run_subtask to research and write unit test fixtures in src/fixtures/user.json.',
    assert: async (ctx) => {
      const controller = await ctx.readFile('src/controllers/user.ts')
      const fixtures = await ctx.readFile('src/fixtures/user.json')
      const calledSubtask = ctx.toolCalls?.some((c) => c.name === 'run_subtask')
      const ok = Boolean(controller && (fixtures || calledSubtask))
      return { ok, message: ok ? undefined : 'Controller or subtask test fixture missing' }
    }
  },
  {
    id: 'hard-02-full-feature-build',
    name: 'Full CRUD feature build',
    tier: 'hard',
    points: 5,
    description: 'Build complete Todo CRUD feature: types, repository, and controller',
    prompt: 'Build a complete Todo CRUD feature with src/types/todo.ts (Todo interface), src/db/todoRepo.ts (in-memory CRUD map), and src/todo.test.ts with tests for create, read, update, delete.',
    assert: async (ctx) => {
      const types = await ctx.readFile('src/types/todo.ts')
      const repo = await ctx.readFile('src/db/todoRepo.ts')
      const test = await ctx.readFile('src/todo.test.ts')
      if (!types || !repo || !test) return { ok: false, message: 'One of the CRUD files is missing' }
      const hasCRUDMethods = /create|get|update|delete/i.test(repo)
      const ok = Boolean(types && repo && test && hasCRUDMethods)
      return { ok, message: ok ? undefined : 'Incomplete CRUD module implementation' }
    }
  },
  {
    id: 'hard-03-memory-leak-fix',
    name: 'Fix React useEffect memory leak',
    tier: 'hard',
    points: 5,
    description: 'Find and fix memory leak in TimerComponent.tsx with setInterval cleanup',
    prompt: 'Fix the memory leak in TimerComponent.tsx where setInterval is never cleared on unmount.',
    initialFiles: {
      'TimerComponent.tsx': 'import React, { useState, useEffect } from "react";\n\nexport function TimerComponent() {\n  const [seconds, setSeconds] = useState(0);\n  useEffect(() => {\n    setInterval(() => {\n      setSeconds(s => s + 1);\n    }, 1000);\n  }, []);\n  return <div>{seconds}</div>;\n}\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('TimerComponent.tsx')
      if (!raw) return { ok: false, message: 'TimerComponent.tsx missing' }
      const hasCleanup = /return\s*\(\)\s*=>\s*clearInterval\(|return\s+clearInterval\(/.test(raw)
      const ok = hasCleanup
      return { ok, message: ok ? undefined : 'useEffect lacks clearInterval cleanup return' }
    }
  },
  {
    id: 'hard-04-recursive-debug',
    name: 'Fix recursive stack overflow',
    tier: 'hard',
    points: 5,
    description: 'Add base case to fix infinite recursion in factorial.ts',
    prompt: 'Fix the RangeError: Maximum call stack size exceeded in factorial.ts by adding proper base case handling for n <= 1.',
    initialFiles: {
      'factorial.ts': 'export function factorial(n: number): number {\n  // Missing base case!\n  return n * factorial(n - 1);\n}\n'
    },
    assert: async (ctx) => {
      const raw = await ctx.readFile('factorial.ts')
      if (!raw) return { ok: false, message: 'factorial.ts missing' }
      const hasBaseCase =
        /if\s*\(\s*n\s*(<=|<|===|==)\s*[012]\s*\)\s*\{?\s*return\s*1/.test(raw) ||
        /if\s*\(\s*n\s*(<=|<|===|==)\s*[012]\s*\)/.test(raw) ||
        /return\s+n\s*(<=|<|===|==)\s*[012]\s*\?\s*1/.test(raw)
      const ok = hasBaseCase
      return { ok, message: ok ? undefined : 'factorial.ts lacks base case guard' }
    }
  },
  {
    id: 'hard-05-hypercode-cot',
    name: 'Architectural context optimization plan',
    tier: 'hard',
    points: 5,
    description: 'Provide architectural design plan and implementation for prompt caching & pruning',
    prompt: 'Write contextOptimizer.ts providing a planContext algorithm that trims oldest tool results when total tokens exceed limit, while preserving prompt prefix stability for KV cache reuse.',
    assert: async (ctx) => {
      const raw = await ctx.readFile('contextOptimizer.ts')
      if (!raw) return { ok: false, message: 'contextOptimizer.ts missing' }
      const hasPlan = /planContext|trimContext/.test(raw)
      const hasKVExplanation = /kv|cache|prefix|token/i.test(raw)
      const ok = hasPlan && hasKVExplanation
      return { ok, message: ok ? undefined : 'contextOptimizer.ts missing planContext or KV-cache stability logic' }
    }
  }
]
