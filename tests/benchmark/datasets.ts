/**
 * Flashgent Benchmark Suite: 100 Production-Grade Scenarios
 *
 * Tier Distribution:
 * - Easy:   50 tasks x 0.5 pts = 25.0 raw pts (Normalized share: 14.0 pts)
 * - Medium: 30 tasks x 2.0 pts = 60.0 raw pts (Normalized share: 26.0 pts)
 * - Hard:   15 tasks x 4.0 pts = 60.0 raw pts (Normalized share: 24.0 pts)
 * - Hell:    5 tasks x 8.0 pts = 40.0 raw pts (Normalized share: 16.0 pts)
 * Total Raw Base: 185.0 raw pts -> Normalized Base: 80.0 pts
 * Quality Modifiers: +20.0 pts
 * Total Standard Score: 100.0 pts
 */

export type ScenarioTier = 'easy' | 'medium' | 'hard' | 'hell'

export interface BenchmarkAssertionContext {
  cwd: string
  resultText?: string
  toolCalls?: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>
  readFile: (relPath: string) => Promise<string | null>
  fileExists: (relPath: string) => Promise<boolean>
}

export function codeStr(...parts: string[]): string {
  return parts.join('')
}

export function b64(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf8')
}

export interface BenchmarkScenario {
  id: string
  name: string
  tier: ScenarioTier
  points: number
  description: string
  prompt: string
  initialFiles?: Record<string, string>
  assert: (ctx: BenchmarkAssertionContext) => Promise<{ ok: boolean; message?: string; partialScore?: number }>
}

export const DATASET_100_SCENARIOS: BenchmarkScenario[] = [
  // =========================================================================
  // EASY (50 tasks x 0.5 pts = 25.0 raw pts)
  // =========================================================================
  {
    id: 'easy-01-branded-types',
    name: 'TypeScript Branded Types',
    tier: 'easy',
    points: 0.5,
    description: 'Create types.ts with branded UserId and validator function',
    prompt: 'Create types.ts exporting branded type UserId = string & { readonly __brand: unique symbol } and an assertUserId(val: string): UserId function that throws if val is not a non-empty string.',
    assert: async (ctx) => {
      const content = await ctx.readFile('types.ts')
      if (!content) return { ok: false, message: 'types.ts not created' }
      const hasBrand = /type\s+UserId\s*=.*__brand/i.test(content) || /UserId.*symbol/i.test(content)
      const hasAssert = /assertUserId/i.test(content) && /throw/i.test(content)
      const ok = hasBrand && hasAssert
      return { ok, message: ok ? undefined : `Missing branded type or assertUserId validator: ${content}` }
    }
  },
  {
    id: 'easy-02-multi-file-version-sync',
    name: 'Multi-file Version Sync',
    tier: 'easy',
    points: 0.5,
    description: 'Find highest version across package.json and Cargo.toml and align them',
    prompt: 'Check package.json (v1.2.0) and Cargo.toml (v1.4.0). Update package.json so its version matches Cargo.toml (1.4.0).',
    initialFiles: {
      'package.json': JSON.stringify({ name: 'polyglot', version: '1.2.0' }, null, 2),
      'Cargo.toml': '[package]\nname = "polyglot"\nversion = "1.4.0"\n'
    },
    assert: async (ctx) => {
      const pkg = await ctx.readFile('package.json')
      if (!pkg) return { ok: false, message: 'package.json missing' }
      try {
        const parsed = JSON.parse(pkg)
        const ok = parsed.version === '1.4.0'
        return { ok, message: ok ? undefined : `package.json version is ${parsed.version}, expected 1.4.0` }
      } catch (e) {
        return { ok: false, message: `Invalid package.json: ${String(e)}` }
      }
    }
  },
  {
    id: 'easy-03-zero-dep-json-validator',
    name: 'Zero-dep JSON Validator with Path Errors',
    tier: 'easy',
    points: 0.5,
    description: 'Create validator.ts checking user object structure and returning exact field error paths',
    prompt: 'Create validator.ts exporting validateUser(obj: any): { valid: boolean; errors: string[] }. Check that obj.id is positive number and obj.email is a string containing "@".',
    assert: async (ctx) => {
      const code = await ctx.readFile('validator.ts')
      if (!code) return { ok: false, message: 'validator.ts not created' }
      const hasFn = /function\s+validateUser|const\s+validateUser/i.test(code)
      const checksId = /id/i.test(code) && />\s*0/i.test(code)
      const checksEmail = /email/i.test(code) && /@/i.test(code)
      const ok = hasFn && checksId && checksEmail
      return { ok, message: ok ? undefined : 'Validator missing required fields or return signature' }
    }
  },
  {
    id: 'easy-04-deep-get-property',
    name: 'Safe Deep Object Accessor',
    tier: 'easy',
    points: 0.5,
    description: 'Create deepGet(obj, path, fallback) handling nested paths',
    prompt: 'Create getDeep.ts exporting function getDeep(obj: any, path: string, fallback?: any): any that traverses dot-separated paths like "a.b.c" and returns fallback if undefined.',
    assert: async (ctx) => {
      const code = await ctx.readFile('getDeep.ts')
      if (!code) return { ok: false, message: 'getDeep.ts not created' }
      const hasSplit = /split\(['".]\.['".]\)/.test(code) || /reduce/.test(code) || /for\s*\(/.test(code)
      const ok = /export\s+(function\s+getDeep|const\s+getDeep)/.test(code) && hasSplit
      return { ok, message: ok ? undefined : 'getDeep function missing or path traversal logic incomplete' }
    }
  },
  {
    id: 'easy-05-shell-log-pipeline',
    name: 'Shell Log File Digest Pipeline',
    tier: 'easy',
    points: 0.5,
    description: 'Run shell command to count error lines in logs and save digest',
    prompt: 'Execute a shell command to count lines in server.log and write the total line count into linecount.txt.',
    initialFiles: {
      'server.log': 'INFO: Boot\nERROR: Connection timeout\nWARN: High memory\nERROR: DB reconnect failed\nINFO: Ready\n'
    },
    assert: async (ctx) => {
      const out = await ctx.readFile('linecount.txt')
      if (!out) return { ok: false, message: 'linecount.txt not created' }
      const hasCount = /\b5\b/.test(out.trim())
      return { ok: hasCount, message: hasCount ? undefined : `Expected line count 5, got: "${out.trim()}"` }
    }
  },
  {
    id: 'easy-06-hmac-token-generator',
    name: 'HMAC SHA-256 Signature Generator',
    tier: 'easy',
    points: 0.5,
    description: 'Create hmac.ts using node:crypto to generate and verify signatures',
    prompt: 'Create hmac.ts exporting createHmacToken(payload: string, secret: string): string using Node.js crypto createHmac with sha256.',
    assert: async (ctx) => {
      const code = await ctx.readFile('hmac.ts')
      if (!code) return { ok: false, message: 'hmac.ts not created' }
      const ok = /createHmac/.test(code) && /sha256/i.test(code) && /digest\(['"]hex['"]\)/i.test(code)
      return { ok, message: ok ? undefined : 'crypto.createHmac with sha256 hex digest required' }
    }
  },
  {
    id: 'easy-07-barrel-export-generator',
    name: 'Barrel Export Generator',
    tier: 'easy',
    points: 0.5,
    description: 'Create index.ts re-exporting modules from components directory',
    prompt: 'Create src/components/index.ts that re-exports everything from Button.tsx, Card.tsx, and Modal.tsx.',
    initialFiles: {
      'src/components/Button.tsx': 'export const Button = () => null;',
      'src/components/Card.tsx': 'export const Card = () => null;',
      'src/components/Modal.tsx': 'export const Modal = () => null;'
    },
    assert: async (ctx) => {
      const code = await ctx.readFile('src/components/index.ts')
      if (!code) return { ok: false, message: 'src/components/index.ts not created' }
      const hasButton = /Button/.test(code)
      const hasCard = /Card/.test(code)
      const hasModal = /Modal/.test(code)
      const ok = hasButton && hasCard && hasModal
      return { ok, message: ok ? undefined : 'Missing re-exports for Button, Card, or Modal' }
    }
  },
  {
    id: 'easy-08-typed-env-parser',
    name: 'Typed Environment Variable Parser',
    tier: 'easy',
    points: 0.5,
    description: 'Parse .env content into strictly typed configuration object',
    prompt: 'Create env.ts exporting parseEnv(raw: string): { PORT: number; DEBUG: boolean; DB_HOST: string } with type conversion.',
    assert: async (ctx) => {
      const code = await ctx.readFile('env.ts')
      if (!code) return { ok: false, message: 'env.ts not created' }
      const ok = /parseInt|Number\(/.test(code) && /=== ['"]true['"]|Boolean\(/.test(code)
      return { ok, message: ok ? undefined : 'env.ts must parse numeric PORT and boolean DEBUG' }
    }
  },
  {
    id: 'easy-09-advanced-gitignore-negative-patterns',
    name: 'Gitignore with Negative Exclusions',
    tier: 'easy',
    points: 0.5,
    description: 'Create .gitignore ignoring *.log except audit.log and ignoring dist/ except dist/bundle.js',
    prompt: 'Create a .gitignore file that ignores all *.log files except !audit.log, and ignores dist/ folder except !dist/bundle.js.',
    assert: async (ctx) => {
      const content = await ctx.readFile('.gitignore')
      if (!content) return { ok: false, message: '.gitignore not created' }
      const ok = /\*\.log/.test(content) && /!audit\.log/.test(content) && /!dist\/bundle\.js/.test(content)
      return { ok, message: ok ? undefined : 'Missing *.log, !audit.log, or !dist/bundle.js patterns' }
    }
  },
  {
    id: 'easy-10-levenshtein-fuzzy-search',
    name: 'Levenshtein Distance Function',
    tier: 'easy',
    points: 0.5,
    description: 'Create levenshtein.ts calculating minimum edit distance between two strings',
    prompt: 'Create levenshtein.ts exporting function levenshtein(a: string, b: string): number calculating minimum edit distance.',
    assert: async (ctx) => {
      const code = await ctx.readFile('levenshtein.ts')
      if (!code) return { ok: false, message: 'levenshtein.ts not created' }
      const ok = /export\s+(function\s+levenshtein|const\s+levenshtein)/.test(code) && /length/.test(code)
      return { ok, message: ok ? undefined : 'levenshtein export not found' }
    }
  },
  {
    id: 'easy-11-tool-ask-user',
    name: 'Interactive Clarification Tool Call',
    tier: 'easy',
    points: 0.5,
    description: 'Dispatch ask_user tool call when requirements are ambiguous',
    prompt: 'Use the ask_user tool to ask whether the project should use "npm" or "pnpm". Do not create files yet.',
    assert: async (ctx) => {
      const call = ctx.toolCalls?.find((c) => c.name === 'ask_user')
      const ok = Boolean(call)
      return { ok, message: ok ? undefined : 'Agent did not call ask_user tool' }
    }
  },
  {
    id: 'easy-12-directory-lister',
    name: 'List Directory with Depth Check',
    tier: 'easy',
    points: 0.5,
    description: 'Call list_dir tool on workspace root',
    prompt: 'List the contents of the root workspace directory using list_dir.',
    assert: async (ctx) => {
      const call = ctx.toolCalls?.find((c) => c.name === 'list_dir')
      const ok = Boolean(call)
      return { ok, message: ok ? undefined : 'list_dir tool call not emitted' }
    }
  },
  {
    id: 'easy-13-circular-dependency-spotter',
    name: 'Detect Circular Dependencies',
    tier: 'easy',
    points: 0.5,
    description: 'Read a.ts and b.ts and output the circular import chain in report.txt',
    prompt: 'Inspect a.ts and b.ts. Write a report in report.txt stating which files form a circular import dependency.',
    initialFiles: {
      'a.ts': b64('aW1wb3J0IHsgYiB9IGZyb20gIi4vYiI7IGV4cG9ydCBjb25zdCBhID0gKCkgPT4gYigpOw=='),
      'b.ts': b64('aW1wb3J0IHsgYSB9IGZyb20gIi4vYSI7IGV4cG9ydCBjb25zdCBiID0gKCkgPT4gYSgpOw==')
    },
    assert: async (ctx) => {
      const report = await ctx.readFile('report.txt')
      if (!report) return { ok: false, message: 'report.txt not created' }
      const ok = /a\.ts/.test(report) && /b\.ts/.test(report) && /circular|cycle/i.test(report)
      return { ok, message: ok ? undefined : 'report.txt must identify circular cycle between a.ts and b.ts' }
    }
  },
  {
    id: 'easy-14-strict-semver-regex',
    name: 'Strict SemVer 2.0 Regex',
    tier: 'easy',
    points: 0.5,
    description: 'Create semver.ts exporting regex matching semver 2.0 with pre-release and build metadata',
    prompt: 'Create semver.ts exporting const SEMVER_REGEX: RegExp compliant with SemVer 2.0 (major.minor.patch-prerelease+build).',
    assert: async (ctx) => {
      const code = await ctx.readFile('semver.ts')
      if (!code) return { ok: false, message: 'semver.ts not created' }
      const ok = /SEMVER_REGEX/.test(code) && (/d\+/.test(code) || /[0-9]/.test(code) || /semver/i.test(code))
      return { ok, message: ok ? undefined : 'SEMVER_REGEX export missing or regex pattern incomplete' }
    }
  },
  {
    id: 'easy-15-markdown-matrix-generator',
    name: 'Markdown Table Matrix from CSV',
    tier: 'easy',
    points: 0.5,
    description: 'Read metrics.csv and generate summary.md with markdown table',
    prompt: 'Read metrics.csv and create summary.md containing a Markdown table with columns: Metric, Value, Status.',
    initialFiles: {
      'metrics.csv': 'Metric,Value,Status\nLatency,45ms,Optimal\nCPU,12%,Normal\nMemory,512MB,Normal\n'
    },
    assert: async (ctx) => {
      const md = await ctx.readFile('summary.md')
      if (!md) return { ok: false, message: 'summary.md not created' }
      const ok = /\|.*Metric.*\|.*Value.*\|.*Status.*\|/i.test(md) && /\|.*Latency.*\|.*45ms.*\|/i.test(md)
      return { ok, message: ok ? undefined : 'summary.md does not contain proper Markdown table' }
    }
  },
  {
    id: 'easy-16-url-query-serializer',
    name: 'URL Query String Serializer',
    tier: 'easy',
    points: 0.5,
    description: 'Create queryString.ts exporting serializeParams(params: Record<string, any>): string',
    prompt: 'Create queryString.ts exporting serializeParams(params: Record<string, any>): string with encodeURIComponent on keys and values.',
    assert: async (ctx) => {
      const code = await ctx.readFile('queryString.ts')
      if (!code) return { ok: false, message: 'queryString.ts not created' }
      const ok = /encodeURIComponent/.test(code) && /serializeParams/.test(code)
      return { ok, message: ok ? undefined : 'serializeParams must use encodeURIComponent' }
    }
  },
  {
    id: 'easy-17-debounce-function',
    name: 'Debounce Wrapper Function',
    tier: 'easy',
    points: 0.5,
    description: 'Create debounce.ts exporting debounce(fn, waitMs)',
    prompt: 'Create debounce.ts exporting function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number): T & { cancel: () => void } with clearTimeout timer reset.',
    assert: async (ctx) => {
      const code = await ctx.readFile('debounce.ts')
      if (!code) return { ok: false, message: 'debounce.ts not created' }
      const ok = /clearTimeout/.test(code) && /setTimeout/.test(code) && /debounce/.test(code)
      return { ok, message: ok ? undefined : 'debounce must manage timer with clearTimeout/setTimeout' }
    }
  },
  {
    id: 'easy-18-deep-clone-utility',
    name: 'Deep Clone with Special Objects',
    tier: 'easy',
    points: 0.5,
    description: 'Create deepClone.ts supporting Dates, Arrays, and nested Objects',
    prompt: 'Create deepClone.ts exporting function deepClone<T>(val: T): T supporting primitives, Dates, Arrays, and plain Objects.',
    assert: async (ctx) => {
      const code = await ctx.readFile('deepClone.ts')
      if (!code) return { ok: false, message: 'deepClone.ts not created' }
      const ok = /deepClone/.test(code) && (/Date/.test(code) || /structuredClone/.test(code) || /typeof/.test(code))
      return { ok, message: ok ? undefined : 'deepClone export not found' }
    }
  },
  {
    id: 'easy-19-event-emitter',
    name: 'Micro EventEmitter',
    tier: 'easy',
    points: 0.5,
    description: 'Create eventEmitter.ts with on, off, and emit methods',
    prompt: 'Create eventEmitter.ts exporting class EventEmitter with on(event: string, fn: Function), off(event: string, fn: Function), and emit(event: string, ...args: any[]): void.',
    assert: async (ctx) => {
      const code = await ctx.readFile('eventEmitter.ts')
      if (!code) return { ok: false, message: 'eventEmitter.ts not created' }
      const ok = /class\s+EventEmitter/.test(code) && /emit\(/.test(code) && /on\(/.test(code)
      return { ok, message: ok ? undefined : 'EventEmitter class with on/emit methods required' }
    }
  },
  {
    id: 'easy-20-binary-search',
    name: 'Binary Search Function',
    tier: 'easy',
    points: 0.5,
    description: 'Create binarySearch.ts returning index of target in sorted array or -1',
    prompt: 'Create binarySearch.ts exporting function binarySearch<T>(arr: T[], target: T, compare?: (a: T, b: T) => number): number.',
    assert: async (ctx) => {
      const code = await ctx.readFile('binarySearch.ts')
      if (!code) return { ok: false, message: 'binarySearch.ts not created' }
      const ok = /binarySearch/.test(code) && /while\s*\(/.test(code) && (/>>>|Math\.floor/.test(code) || /\/\s*2/.test(code))
      return { ok, message: ok ? undefined : 'binarySearch with midpoint calculation required' }
    }
  },
  {
    id: 'easy-21-topological-sort',
    name: 'DAG Topological Sort',
    tier: 'easy',
    points: 0.5,
    description: 'Create topoSort.ts ordering dependencies and throwing on cycles',
    prompt: 'Create topoSort.ts exporting function topoSort(nodes: string[], edges: [string, string][]): string[] throwing Error on cycle.',
    assert: async (ctx) => {
      const code = await ctx.readFile('topoSort.ts')
      if (!code) return { ok: false, message: 'topoSort.ts not created' }
      const ok = /topoSort/.test(code) && (/inDegree|visited|depth|cycle/i.test(code) || /throw/i.test(code))
      return { ok, message: ok ? undefined : 'topoSort export with cycle detection required' }
    }
  },
  {
    id: 'easy-22-ansi-escape-stripper',
    name: 'ANSI Escape Code Stripper',
    tier: 'easy',
    points: 0.5,
    description: 'Create stripAnsi.ts removing terminal color codes from text',
    prompt: 'Create stripAnsi.ts exporting function stripAnsi(str: string): string using regex to strip ANSI escape codes (\\u001b\\[[0-9;]*m).',
    assert: async (ctx) => {
      const code = await ctx.readFile('stripAnsi.ts')
      if (!code) return { ok: false, message: 'stripAnsi.ts not created' }
      const ok = /stripAnsi/.test(code) && (/\\u001b|\\x1b|\\x1B/.test(code) || /replace/.test(code))
      return { ok, message: ok ? undefined : 'stripAnsi function with regex replacement required' }
    }
  },
  {
    id: 'easy-23-lru-cache',
    name: 'LRU Cache Fixed Capacity',
    tier: 'easy',
    points: 0.5,
    description: 'Create lru.ts exporting LRUCache class with get and put',
    prompt: 'Create lru.ts exporting class LRUCache<K, V> with capacity, get(key: K): V | undefined, and put(key: K, value: V): void using Map key re-insertion.',
    assert: async (ctx) => {
      const code = await ctx.readFile('lru.ts')
      if (!code) return { ok: false, message: 'lru.ts not created' }
      const ok = /class\s+LRUCache/.test(code) && /get\(/.test(code) && /put\(|set\(/.test(code) && /Map/.test(code)
      return { ok, message: ok ? undefined : 'LRUCache class with Map backing required' }
    }
  },
  {
    id: 'easy-24-token-bucket-rate-limiter',
    name: 'Token Bucket Rate Limiter',
    tier: 'easy',
    points: 0.5,
    description: 'Create rateLimiter.ts with tryConsume(tokens)',
    prompt: 'Create rateLimiter.ts exporting class TokenBucket with capacity, refillRatePerSec, and tryConsume(tokens = 1): boolean.',
    assert: async (ctx) => {
      const code = await ctx.readFile('rateLimiter.ts')
      if (!code) return { ok: false, message: 'rateLimiter.ts not created' }
      const ok = /TokenBucket/.test(code) && /tryConsume/.test(code) && /Date\.now|performance\.now/.test(code)
      return { ok, message: ok ? undefined : 'TokenBucket class with timestamp refilling required' }
    }
  },
  {
    id: 'easy-25-json-to-ts-interface',
    name: 'JSON to TypeScript Type Generator',
    tier: 'easy',
    points: 0.5,
    description: 'Create jsonToTs.ts exporting inferInterface(name: string, obj: any): string',
    prompt: 'Create jsonToTs.ts exporting inferInterface(name: string, obj: any): string returning TypeScript interface string.',
    assert: async (ctx) => {
      const code = await ctx.readFile('jsonToTs.ts')
      if (!code) return { ok: false, message: 'jsonToTs.ts not created' }
      const ok = /inferInterface/.test(code) && /typeof/.test(code) && /interface/.test(code)
      return { ok, message: ok ? undefined : 'inferInterface function required' }
    }
  },
  {
    id: 'easy-26-multipart-boundary-parser',
    name: 'Multipart Header Boundary Parser',
    tier: 'easy',
    points: 0.5,
    description: 'Create multipart.ts extracting boundary string from Content-Type header',
    prompt: 'Create multipart.ts exporting function extractBoundary(contentType: string): string | null matching boundary=... in header.',
    assert: async (ctx) => {
      const code = await ctx.readFile('multipart.ts')
      if (!code) return { ok: false, message: 'multipart.ts not created' }
      const ok = /extractBoundary/.test(code) && /boundary=/i.test(code)
      return { ok, message: ok ? undefined : 'extractBoundary function with boundary regex required' }
    }
  },
  {
    id: 'easy-27-uuid-v4-validator',
    name: 'UUID v4 Validator',
    tier: 'easy',
    points: 0.5,
    description: 'Create uuid.ts exporting isUuidV4(str: string): boolean',
    prompt: 'Create uuid.ts exporting function isUuidV4(str: string): boolean checking strict 8-4-4-4-12 hex format with version 4 character.',
    assert: async (ctx) => {
      const code = await ctx.readFile('uuid.ts')
      if (!code) return { ok: false, message: 'uuid.ts not created' }
      const ok = /isUuidV4/.test(code) && (/4[0-9a-fA-F]{3}/.test(code) || /uuid|regex|test/i.test(code) || /[0-9a-f]/i.test(code))
      return { ok, message: ok ? undefined : 'isUuidV4 with UUID v4 pattern required' }
    }
  },
  {
    id: 'easy-28-exponential-backoff-jitter',
    name: 'Exponential Backoff with Jitter',
    tier: 'easy',
    points: 0.5,
    description: 'Create backoff.ts calculating retry delays with full jitter formula',
    prompt: 'Create backoff.ts exporting function calculateBackoff(attempt: number, baseMs = 100, maxMs = 5000): number with Math.random jitter.',
    assert: async (ctx) => {
      const code = await ctx.readFile('backoff.ts')
      if (!code) return { ok: false, message: 'backoff.ts not created' }
      const ok = /calculateBackoff/.test(code) && /Math\.random/.test(code) && (/Math\.min/.test(code) || /Math\.pow/.test(code) || /2\s*\*\*/.test(code))
      return { ok, message: ok ? undefined : 'calculateBackoff with Math.random and exponential growth required' }
    }
  },
  {
    id: 'easy-29-math-expression-tokenizer',
    name: 'Math Expression Tokenizer',
    tier: 'easy',
    points: 0.5,
    description: 'Create tokenizer.ts splitting arithmetic strings into numbers, operators, and parentheses',
    prompt: 'Create tokenizer.ts exporting tokenize(expr: string): string[] returning array of tokens for numbers, +, -, *, /, (, ).',
    assert: async (ctx) => {
      const code = await ctx.readFile('tokenizer.ts')
      if (!code) return { ok: false, message: 'tokenizer.ts not created' }
      const ok = /tokenize/.test(code) && /match|replace|split|while/.test(code)
      return { ok, message: ok ? undefined : 'tokenize function required' }
    }
  },
  {
    id: 'easy-30-markdown-checklist-updater',
    name: 'Markdown Checklist Item Toggle',
    tier: 'easy',
    points: 0.5,
    description: 'Create checklist.ts toggling [ ] to [x] for specified task line',
    prompt: 'Create checklist.ts exporting toggleTask(md: string, taskText: string, completed: boolean): string updating "- [ ] task" to "- [x] task".',
    assert: async (ctx) => {
      const code = await ctx.readFile('checklist.ts')
      if (!code) return { ok: false, message: 'checklist.ts not created' }
      const ok = /toggleTask/.test(code) && /\[\s*\]|\[x\]/i.test(code)
      return { ok, message: ok ? undefined : 'toggleTask function required' }
    }
  },
  {
    id: 'easy-31-conventional-commit-linter',
    name: 'Conventional Commit Message Validator',
    tier: 'easy',
    points: 0.5,
    description: 'Create commitLint.ts validating feat|fix|docs|refactor|test|chore prefixes',
    prompt: 'Create commitLint.ts exporting function isValidCommit(msg: string): boolean checking Conventional Commits format (e.g. feat(auth): add login).',
    assert: async (ctx) => {
      const code = await ctx.readFile('commitLint.ts')
      if (!code) return { ok: false, message: 'commitLint.ts not created' }
      const ok = /isValidCommit/.test(code) && /feat|fix|chore|docs|refactor|test/i.test(code)
      return { ok, message: ok ? undefined : 'isValidCommit matching feat/fix prefixes required' }
    }
  },
  {
    id: 'easy-32-yaml-scalar-parser',
    name: 'Simple YAML Key-Value Parser',
    tier: 'easy',
    points: 0.5,
    description: 'Create yaml.ts parsing flat key: value YAML strings into object',
    prompt: 'Create yaml.ts exporting function parseYamlFlat(content: string): Record<string, string | number | boolean>.',
    assert: async (ctx) => {
      const code = await ctx.readFile('yaml.ts')
      if (!code) return { ok: false, message: 'yaml.ts not created' }
      const ok = /parseYamlFlat/.test(code) && /split\(['"]\\n['"]\)|split\(\/\\r\?\\n\/\)/.test(code)
      return { ok, message: ok ? undefined : 'parseYamlFlat function required' }
    }
  },
  {
    id: 'easy-33-base64-hex-codec',
    name: 'Base64 and Hex Buffer Codec',
    tier: 'easy',
    points: 0.5,
    description: 'Create codec.ts with base64ToHex and hexToBase64 functions',
    prompt: 'Create codec.ts exporting base64ToHex(b64: string): string and hexToBase64(hex: string): string using Buffer.',
    assert: async (ctx) => {
      const code = await ctx.readFile('codec.ts')
      if (!code) return { ok: false, message: 'codec.ts not created' }
      const ok = /Buffer\.from/.test(code) && /base64ToHex/.test(code) && /hexToBase64/.test(code)
      return { ok, message: ok ? undefined : 'codec.ts using Buffer.from conversions required' }
    }
  },
  {
    id: 'easy-34-promise-timeout-wrapper',
    name: 'Promise withTimeout Wrapper',
    tier: 'easy',
    points: 0.5,
    description: 'Create withTimeout.ts rejecting with TimeoutError if promise takes too long',
    prompt: 'Create withTimeout.ts exporting function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> using Promise.race.',
    assert: async (ctx) => {
      const code = await ctx.readFile('withTimeout.ts')
      if (!code) return { ok: false, message: 'withTimeout.ts not created' }
      const ok = /withTimeout/.test(code) && /Promise\.race|setTimeout/.test(code)
      return { ok, message: ok ? undefined : 'withTimeout using Promise.race or setTimeout required' }
    }
  },
  {
    id: 'easy-35-human-bytes-formatter',
    name: 'Human Readable File Size Formatter',
    tier: 'easy',
    points: 0.5,
    description: 'Create formatBytes.ts converting byte counts to B, KB, MB, GB strings',
    prompt: 'Create formatBytes.ts exporting function formatBytes(bytes: number, decimals = 2): string converting 1024 -> "1 KB".',
    assert: async (ctx) => {
      const code = await ctx.readFile('formatBytes.ts')
      if (!code) return { ok: false, message: 'formatBytes.ts not created' }
      const ok = /formatBytes/.test(code) && /1024/.test(code) && /toFixed|Math\.round/.test(code)
      return { ok, message: ok ? undefined : 'formatBytes function required' }
    }
  },
  {
    id: 'easy-36-semver-comparator',
    name: 'SemVer Comparator (gt, lt, eq)',
    tier: 'easy',
    points: 0.5,
    description: 'Create semverCompare.ts exporting compareSemVer(v1: string, v2: string): number (-1, 0, 1)',
    prompt: 'Create semverCompare.ts exporting compareSemVer(a: string, b: string): number comparing major, minor, patch.',
    assert: async (ctx) => {
      const code = await ctx.readFile('semverCompare.ts')
      if (!code) return { ok: false, message: 'semverCompare.ts not created' }
      const ok = /compareSemVer/.test(code) && /split\(['"]\.['"]\)/.test(code)
      return { ok, message: ok ? undefined : 'compareSemVer function required' }
    }
  },
  {
    id: 'easy-37-csv-row-parser',
    name: 'CSV Row Parser with Quotes',
    tier: 'easy',
    points: 0.5,
    description: 'Create parseCsvLine.ts splitting CSV rows with quoted strings and escaped commas',
    prompt: 'Create parseCsvLine.ts exporting function parseCsvLine(line: string): string[] handling quoted values like \'1,"hello, world",3\'.',
    assert: async (ctx) => {
      const code = await ctx.readFile('parseCsvLine.ts')
      if (!code) return { ok: false, message: 'parseCsvLine.ts not created' }
      const ok = /parseCsvLine/.test(code) && (/while|for|match|regex/i.test(code) || /indexOf/.test(code))
      return { ok, message: ok ? undefined : 'parseCsvLine function required' }
    }
  },
  {
    id: 'easy-38-object-diff-checker',
    name: 'Shallow Object Diff',
    tier: 'easy',
    points: 0.5,
    description: 'Create diffObjects.ts returning added, modified, deleted keys',
    prompt: 'Create diffObjects.ts exporting diffObjects(oldObj: Record<string, any>, newObj: Record<string, any>): { added: string[]; modified: string[]; deleted: string[] }.',
    assert: async (ctx) => {
      const code = await ctx.readFile('diffObjects.ts')
      if (!code) return { ok: false, message: 'diffObjects.ts not created' }
      const ok = /diffObjects/.test(code) && /added/.test(code) && /modified/.test(code) && /deleted/.test(code)
      return { ok, message: ok ? undefined : 'diffObjects returning added/modified/deleted keys required' }
    }
  },
  {
    id: 'easy-39-cookie-header-parser',
    name: 'HTTP Cookie Header Parser',
    tier: 'easy',
    points: 0.5,
    description: 'Create cookie.ts parsing "a=1; b=2" string into key-value map',
    prompt: 'Create cookie.ts exporting parseCookies(header: string): Record<string, string> decoding URI components.',
    assert: async (ctx) => {
      const code = await ctx.readFile('cookie.ts')
      if (!code) return { ok: false, message: 'cookie.ts not created' }
      const ok = /parseCookies/.test(code) && /decodeURIComponent/.test(code) && /split\(['"];\s*['"]\)/.test(code)
      return { ok, message: ok ? undefined : 'parseCookies with decodeURIComponent required' }
    }
  },
  {
    id: 'easy-40-hex-to-rgb-converter',
    name: 'Hex to RGB Color Converter',
    tier: 'easy',
    points: 0.5,
    description: 'Create color.ts converting "#ffffff" to { r: 255, g: 255, b: 255 }',
    prompt: 'Create color.ts exporting hexToRgb(hex: string): { r: number; g: number; b: number } | null supporting 3 and 6 digit hex colors.',
    assert: async (ctx) => {
      const code = await ctx.readFile('color.ts')
      if (!code) return { ok: false, message: 'color.ts not created' }
      const ok = /hexToRgb/.test(code) && /parseInt/.test(code) && /16/.test(code)
      return { ok, message: ok ? undefined : 'hexToRgb using parseInt(..., 16) required' }
    }
  },
  {
    id: 'easy-41-ip-cidr-matcher',
    name: 'IPv4 CIDR Subnet Matcher',
    tier: 'easy',
    points: 0.5,
    description: 'Create cidr.ts checking if an IP is within CIDR block (e.g. 192.168.1.0/24)',
    prompt: 'Create cidr.ts exporting ipInCidr(ip: string, cidr: string): boolean using bitwise operations.',
    assert: async (ctx) => {
      const code = await ctx.readFile('cidr.ts')
      if (!code) return { ok: false, message: 'cidr.ts not created' }
      const ok = /ipInCidr/.test(code) && /split\(['"]\/['"]\)/.test(code) && (/>>>|<<|&/.test(code) || /split\(['"]\.['"]\)/.test(code))
      return { ok, message: ok ? undefined : 'ipInCidr function required' }
    }
  },
  {
    id: 'easy-42-cron-validator',
    name: '5-Field Cron Expression Validator',
    tier: 'easy',
    points: 0.5,
    description: 'Create cronValidator.ts validating minute, hour, day, month, weekday format',
    prompt: 'Create cronValidator.ts exporting isValidCron(expr: string): boolean validating 5 whitespace-separated fields.',
    assert: async (ctx) => {
      const code = await ctx.readFile('cronValidator.ts')
      if (!code) return { ok: false, message: 'cronValidator.ts not created' }
      const ok = /isValidCron/.test(code) && /split\(\/\\s\+\/\)/.test(code) && /length\s*===\s*5/.test(code)
      return { ok, message: ok ? undefined : 'isValidCron checking 5 fields required' }
    }
  },
  {
    id: 'easy-43-path-normalizer',
    name: 'Posix Path Normalizer (without node:path)',
    tier: 'easy',
    points: 0.5,
    description: 'Create normalizePath.ts resolving ./ and ../ segments cleanly',
    prompt: 'Create normalizePath.ts exporting normalizePosixPath(p: string): string resolving "." and ".." segments without importing node:path.',
    assert: async (ctx) => {
      const code = await ctx.readFile('normalizePath.ts')
      if (!code) return { ok: false, message: 'normalizePath.ts not created' }
      const ok = /normalizePosixPath/.test(code) && /pop\(\)/.test(code) && /push\(/.test(code) && !/from\s+['"]node:path['"]/.test(code)
      return { ok, message: ok ? undefined : 'normalizePosixPath using stack segments without node:path required' }
    }
  },
  {
    id: 'easy-44-priority-queue',
    name: 'Binary Heap Priority Queue',
    tier: 'easy',
    points: 0.5,
    description: 'Create PriorityQueue class with enqueue and dequeue',
    prompt: 'Create priorityQueue.ts exporting PriorityQueue<T> with push(item: T, priority: number) and pop(): T | undefined.',
    assert: async (ctx) => {
      const code = await ctx.readFile('priorityQueue.ts')
      if (!code) return { ok: false, message: 'priorityQueue.ts not created' }
      const ok = /class\s+PriorityQueue/.test(code) && /push|enqueue/.test(code) && /pop|dequeue/.test(code)
      return { ok, message: ok ? undefined : 'PriorityQueue class with push/pop required' }
    }
  },
  {
    id: 'easy-45-trie-autocomplete',
    name: 'Trie Prefix Search Tree',
    tier: 'easy',
    points: 0.5,
    description: 'Create trie.ts with insert and findWordsWithPrefix methods',
    prompt: 'Create trie.ts exporting class Trie with insert(word: string): void and autocomplete(prefix: string): string[].',
    assert: async (ctx) => {
      const code = await ctx.readFile('trie.ts')
      if (!code) return { ok: false, message: 'trie.ts not created' }
      const ok = /class\s+Trie/.test(code) && /insert\(/.test(code) && /autocomplete|find/.test(code)
      return { ok, message: ok ? undefined : 'Trie class with insert and prefix search required' }
    }
  },
  {
    id: 'easy-46-unicode-slugifier',
    name: 'Unicode Diacritic Slugifier',
    tier: 'easy',
    points: 0.5,
    description: 'Create slugify.ts normalizing accents ("Café" -> "cafe")',
    prompt: 'Create slugify.ts exporting function slugify(text: string): string normalizing diacritics via String.prototype.normalize("NFD") and replacing non-alphanumerics with hyphens.',
    assert: async (ctx) => {
      const code = await ctx.readFile('slugify.ts')
      if (!code) return { ok: false, message: 'slugify.ts not created' }
      const ok = /slugify/.test(code) && /normalize\(['"]NFD['"]\)/.test(code)
      return { ok, message: ok ? undefined : 'slugify with NFD normalization required' }
    }
  },
  {
    id: 'easy-47-memory-usage-formatter',
    name: 'Process Memory Usage Formatter',
    tier: 'easy',
    points: 0.5,
    description: 'Create memory.ts returning heapUsed and heapTotal formatted in MB',
    prompt: 'Create memory.ts exporting function getMemoryStats(): { heapUsedMb: number; heapTotalMb: number; rssMb: number } using process.memoryUsage().',
    assert: async (ctx) => {
      const code = await ctx.readFile('memory.ts')
      if (!code) return { ok: false, message: 'memory.ts not created' }
      const ok = /process\.memoryUsage/.test(code) && /heapUsed/.test(code) && /1024/.test(code)
      return { ok, message: ok ? undefined : 'getMemoryStats using process.memoryUsage required' }
    }
  },
  {
    id: 'easy-48-cli-arg-parser',
    name: 'Zero-dep CLI Argument Parser',
    tier: 'easy',
    points: 0.5,
    description: 'Create parseArgs.ts parsing --flag, -f, and --key=val args',
    prompt: 'Create parseArgs.ts exporting function parseCliArgs(argv: string[]): { flags: Record<string, boolean | string>; positional: string[] }.',
    assert: async (ctx) => {
      const code = await ctx.readFile('parseArgs.ts')
      if (!code) return { ok: false, message: 'parseArgs.ts not created' }
      const ok = /parseCliArgs/.test(code) && /startsWith\(['"]--['"]\)/.test(code)
      return { ok, message: ok ? undefined : 'parseCliArgs function required' }
    }
  },
  {
    id: 'easy-49-string-template-interpolator',
    name: 'Safe Template String Interpolator',
    tier: 'easy',
    points: 0.5,
    description: 'Create template.ts replacing {{user.name}} tokens safely',
    prompt: 'Create template.ts exporting renderTemplate(template: string, data: Record<string, any>): string replacing {{key}} tokens with data values.',
    assert: async (ctx) => {
      const code = await ctx.readFile('template.ts')
      if (!code) return { ok: false, message: 'template.ts not created' }
      const ok = /renderTemplate/.test(code) && /replace\(/.test(code) && /\{\{/.test(code)
      return { ok, message: ok ? undefined : 'renderTemplate with {{token}} replacement required' }
    }
  },
  {
    id: 'easy-50-unified-diff-generator',
    name: 'Unified Diff Patch Generator',
    tier: 'easy',
    points: 0.5,
    description: 'Create diff.ts outputting standard unified diff format with --- +++ headers',
    prompt: 'Create diff.ts exporting generateUnifiedDiff(filename: string, oldText: string, newText: string): string with "--- a/filename" and "+++ b/filename" headers.',
    assert: async (ctx) => {
      const code = await ctx.readFile('diff.ts')
      if (!code) return { ok: false, message: 'diff.ts not created' }
      const ok = /generateUnifiedDiff/.test(code) && /---/.test(code) && /\+\+\+/.test(code)
      return { ok, message: ok ? undefined : 'generateUnifiedDiff with --- and +++ headers required' }
    }
  },

  // =========================================================================
  // MEDIUM (30 tasks x 2.0 pts = 60.0 raw pts)
  // =========================================================================
  {
    id: 'med-01-async-iterator-backpressure',
    name: 'EventEmitter to AsyncIterator with Backpressure',
    tier: 'medium',
    points: 2.0,
    description: 'Create streamToAsyncIterator with backpressure queue and pause/resume',
    prompt: 'Create streamIterator.ts exporting function streamToAsyncIterable<T>(stream: NodeJS.ReadableStream): AsyncIterableIterator<T> with buffer queue and pause/resume backpressure management.',
    assert: async (ctx) => {
      const code = await ctx.readFile('streamIterator.ts')
      if (!code) return { ok: false, message: 'streamIterator.ts missing' }
      const hasSymbol = /Symbol\.asyncIterator/.test(code)
      const hasPauseResume = /pause\(/.test(code) && /resume\(/.test(code)
      const ok = hasSymbol && hasPauseResume
      return { ok, message: ok ? undefined : 'Must implement Symbol.asyncIterator and handle stream.pause()/resume() backpressure' }
    }
  },
  {
    id: 'med-02-react-debounced-fetch-hook',
    name: 'React useDebouncedFetch Hook with AbortController',
    tier: 'medium',
    points: 2.0,
    description: 'Create useDebouncedFetch with in-flight cancellation, caching, and cleanup',
    prompt: 'Create useDebouncedFetch.ts exporting custom React hook useDebouncedFetch<T>(url: string, delayMs = 300): { data: T | null; loading: boolean; error: Error | null } using AbortController on unmount and parameter changes.',
    assert: async (ctx) => {
      const code = await ctx.readFile('useDebouncedFetch.ts')
      if (!code) return { ok: false, message: 'useDebouncedFetch.ts missing' }
      const hasHook = /export\s+(function\s+useDebouncedFetch|const\s+useDebouncedFetch)/.test(code)
      const hasAbort = /AbortController/.test(code) && /signal/.test(code)
      const hasCleanup = /return\s*\(\)\s*=>/.test(code)
      const ok = hasHook && hasAbort && hasCleanup
      return { ok, message: ok ? undefined : 'Hook must use AbortController, attach signal to fetch, and abort on cleanup' }
    }
  },
  {
    id: 'med-03-dependency-inversion-refactor',
    name: 'Dependency Inversion Architecture Refactor',
    tier: 'medium',
    points: 2.0,
    description: 'Refactor UserService and Database to inject interfaces rather than direct instances',
    prompt: 'Refactor service.ts and database.ts. Create types.ts with IDatabase interface and inject IDatabase into UserService constructor instead of directly instantiating Database.',
    initialFiles: {
      'database.ts': 'export class Database { query(sql: string) { return [{ id: 1 }]; } }',
      'service.ts': b64('aW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICIuL2RhdGFiYXNlIjsgZXhwb3J0IGNsYXNzIFVzZXJTZXJ2aWNlIHsgcHJpdmF0ZSBkYiA9IG5ldyBEYXRhYmFzZSgpOyBnZXRVc2VyKCkgeyByZXR1cm4gdGhpcy5kYi5xdWVyeSgiU0VMRUNUIDEiKTsgfSB9')
    },
    assert: async (ctx) => {
      const types = await ctx.readFile('types.ts')
      const service = await ctx.readFile('service.ts')
      if (!types || !service) return { ok: false, message: 'types.ts or service.ts missing' }
      const hasInterface = /interface\s+IDatabase/.test(types)
      const hasConstructorInjection = /constructor\s*\(\s*(private|public|readonly)?\s*db\s*:\s*IDatabase/i.test(service) || /constructor\(db: IDatabase\)/.test(service)
      const ok = hasInterface && hasConstructorInjection
      return { ok, message: ok ? undefined : 'IDatabase interface and constructor dependency injection required' }
    }
  },
  {
    id: 'med-04-jsonrpc-batch-server',
    name: 'JSON-RPC 2.0 Batch Protocol Handler',
    tier: 'medium',
    points: 2.0,
    description: 'Create jsonRpcHandler supporting single & batch requests with standard error codes',
    prompt: 'Create rpcHandler.ts exporting handleJsonRpc(request: any, methods: Record<string, Function>): Promise<any>. Support single and array batch requests, return -32601 for Method not found and -32600 for Invalid Request.',
    assert: async (ctx) => {
      const code = await ctx.readFile('rpcHandler.ts')
      if (!code) return { ok: false, message: 'rpcHandler.ts missing' }
      const hasBatch = /Array\.isArray/.test(code)
      const hasCodes = /-32601/.test(code) && /-32600/.test(code)
      const ok = hasBatch && hasCodes
      return { ok, message: ok ? undefined : 'handleJsonRpc must handle Array batch requests and -32601/-32600 error codes' }
    }
  },
  {
    id: 'med-05-multi-file-refactor-5-files',
    name: 'Multi-File Signature Refactor (5 Interconnected Files)',
    tier: 'medium',
    points: 2.0,
    description: 'Change calculatePayment signature to accept PaymentOptions across all 5 layers',
    prompt: 'Refactor math.ts, service.ts, controller.ts, router.ts, and index.ts: change calculatePayment(amount: number, fee: number) to calculatePayment(opts: { amount: number; fee: number; currency?: string }) and update all call sites.',
    initialFiles: {
      'math.ts': 'export function calculatePayment(amount: number, fee: number) { return amount + fee; }',
      'service.ts': b64('aW1wb3J0IHsgY2FsY3VsYXRlUGF5bWVudCB9IGZyb20gIi4vbWF0aCI7IGV4cG9ydCBmdW5jdGlvbiBwcm9jZXNzT3JkZXIoYTogbnVtYmVyLCBiOiBudW1iZXIpIHsgcmV0dXJuIGNhbGN1bGF0ZVBheW1lbnQoYSwgYik7IH0='),
      'controller.ts': b64('aW1wb3J0IHsgcHJvY2Vzc09yZGVyIH0gZnJvbSAiLi9zZXJ2aWNlIjsgZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZVBvc3QocmVxOiBhbnkpIHsgcmV0dXJuIHByb2Nlc3NPcmRlcihyZXEuYW1vdW50LCByZXEuZmVlKTsgfQ=='),
      'router.ts': b64('aW1wb3J0IHsgaGFuZGxlUG9zdCB9IGZyb20gIi4vY29udHJvbGxlciI7IGV4cG9ydCBjb25zdCByb3V0ZSA9IChyZXE6IGFueSkgPT4gaGFuZGxlUG9zdChyZXEpOw=='),
      'index.ts': b64('aW1wb3J0IHsgcm91dGUgfSBmcm9tICIuL3JvdXRlciI7IGNvbnNvbGUubG9nKHJvdXRlKHsgYW1vdW50OiAxMDAsIGZlZTogMTAgfSkpOw==')
    },
    assert: async (ctx) => {
      const math = await ctx.readFile('math.ts')
      const service = await ctx.readFile('service.ts')
      const controller = await ctx.readFile('controller.ts')
      const index = await ctx.readFile('index.ts')
      if (!math || !service || !controller || !index) return { ok: false, message: 'Missing files in 5-file refactor' }
      const mathOk = /opts\s*:\s*\{\s*amount/.test(math) || /calculatePayment\(\s*\{\s*amount/.test(math)
      const serviceOk = /calculatePayment\(\s*\{\s*amount/.test(service)
      const ok = mathOk && serviceOk
      return { ok, message: ok ? undefined : 'math.ts and service.ts call sites not updated to object options signature' }
    }
  },
  {
    id: 'med-06-vitest-fake-timers-suite',
    name: 'Vitest Unit Test Suite with Fake Timers',
    tier: 'medium',
    points: 2.0,
    description: 'Write retryWithBackoff.test.ts using vi.useFakeTimers and vi.advanceTimersByTime',
    prompt: 'Create retryWithBackoff.test.ts using Vitest (describe, it, expect, vi). Test that a function is retried with backoff using vi.useFakeTimers() and vi.advanceTimersByTimeAsync().',
    assert: async (ctx) => {
      const code = await ctx.readFile('retryWithBackoff.test.ts')
      if (!code) return { ok: false, message: 'retryWithBackoff.test.ts missing' }
      const hasFakeTimers = /vi\.useFakeTimers/.test(code) && (/advanceTimers/i.test(code) || /runAllTimers/i.test(code))
      const hasAssertions = /expect\(/.test(code)
      const ok = hasFakeTimers && hasAssertions
      return { ok, message: ok ? undefined : 'Test suite must use vi.useFakeTimers and advance timers' }
    }
  },
  {
    id: 'med-07-async-mutex-semaphore',
    name: 'AsyncMutex and AsyncSemaphore in TypeScript',
    tier: 'medium',
    points: 2.0,
    description: 'Create mutex.ts with acquire, release, and withLock methods',
    prompt: 'Create mutex.ts exporting class AsyncMutex with acquire(): Promise<() => void> and withLock<T>(fn: () => Promise<T>): Promise<T>, guaranteeing FIFO lock acquisition.',
    assert: async (ctx) => {
      const code = await ctx.readFile('mutex.ts')
      if (!code) return { ok: false, message: 'mutex.ts missing' }
      const ok = /class\s+AsyncMutex/.test(code) && /withLock/.test(code) && /Promise/.test(code)
      return { ok, message: ok ? undefined : 'AsyncMutex with acquire and withLock methods required' }
    }
  },
  {
    id: 'med-08-zod-cross-field-refinements',
    name: 'Zod Schema with Cross-Field Conditional Refinements',
    tier: 'medium',
    points: 2.0,
    description: 'Create addressSchema validating zip format by country and requiring taxId when isCompany is true',
    prompt: 'Create schema.ts exporting checkoutSchema using zod with .superRefine() or .refine(). If isCompany is true, vatNumber is required. If country is "US", zip must match /\\d{5}/.',
    assert: async (ctx) => {
      const code = await ctx.readFile('schema.ts')
      if (!code) return { ok: false, message: 'schema.ts missing' }
      const hasRefine = /refine|superRefine/.test(code)
      const hasVat = /vatNumber|isCompany/.test(code)
      const hasZip = /zip|postalCode/.test(code)
      const ok = hasRefine && hasVat && hasZip
      return { ok, message: ok ? undefined : 'checkoutSchema must use refine/superRefine for conditional fields' }
    }
  },
  {
    id: 'med-09-shunting-yard-evaluator',
    name: 'Shunting-Yard Math Expression Evaluator',
    tier: 'medium',
    points: 2.0,
    description: 'Create evaluateExpr(str) handling operator precedence (+, -, *, /) and parentheses',
    prompt: 'Create evaluator.ts exporting evaluate(expr: string): number implementing the Shunting-Yard algorithm or recursive descent parsing for +, -, *, /, and parentheses.',
    assert: async (ctx) => {
      const code = await ctx.readFile('evaluator.ts')
      if (!code) return { ok: false, message: 'evaluator.ts missing' }
      const ok = /evaluate/.test(code) && (/stack|postfix|rpn|precedence|parse/i.test(code))
      return { ok, message: ok ? undefined : 'evaluator.ts with AST/stack precedence parser required' }
    }
  },
  {
    id: 'med-10-circuit-breaker-fsm',
    name: 'Circuit Breaker State Machine',
    tier: 'medium',
    points: 2.0,
    description: 'Create CircuitBreaker class with CLOSED, OPEN, HALF_OPEN states and reset cooldown',
    prompt: 'Create circuitBreaker.ts exporting CircuitBreaker with execute<T>(action: () => Promise<T>): Promise<T>, failureThreshold, cooldownMs, and state getter ("CLOSED" | "OPEN" | "HALF_OPEN").',
    assert: async (ctx) => {
      const code = await ctx.readFile('circuitBreaker.ts')
      if (!code) return { ok: false, message: 'circuitBreaker.ts missing' }
      const ok = /CLOSED/.test(code) && /OPEN/.test(code) && /HALF_OPEN/.test(code) && /failureThreshold/.test(code)
      return { ok, message: ok ? undefined : 'CircuitBreaker state machine with CLOSED/OPEN/HALF_OPEN required' }
    }
  },
  {
    id: 'med-11-websocket-reconnect-manager',
    name: 'WebSocket Auto-Reconnect Manager with Offline Queue',
    tier: 'medium',
    points: 2.0,
    description: 'Create wsManager.ts queuing messages while disconnected and sending on reconnect',
    prompt: 'Create wsManager.ts exporting class ReconnectingWebSocket with send(msg: string), offline queue buffering, and exponential backoff on close.',
    assert: async (ctx) => {
      const code = await ctx.readFile('wsManager.ts')
      if (!code) return { ok: false, message: 'wsManager.ts missing' }
      const ok = /ReconnectingWebSocket/.test(code) && /queue|buffer/i.test(code) && /reconnect/i.test(code)
      return { ok, message: ok ? undefined : 'ReconnectingWebSocket with offline queue required' }
    }
  },
  {
    id: 'med-12-sqlite-migration-runner',
    name: 'SQLite Migration Runner with Rollbacks',
    tier: 'medium',
    points: 2.0,
    description: 'Create migrate.ts running up/down migrations in atomic transactions',
    prompt: 'Create migrate.ts exporting runMigrations(db: any, migrations: Array<{ id: number; up: string; down: string }>): Promise<void> wrapping each migration in a TRANSACTION.',
    assert: async (ctx) => {
      const code = await ctx.readFile('migrate.ts')
      if (!code) return { ok: false, message: 'migrate.ts missing' }
      const ok = /runMigrations/.test(code) && /BEGIN|TRANSACTION/i.test(code) && /COMMIT/i.test(code)
      return { ok, message: ok ? undefined : 'runMigrations with transaction wrapper required' }
    }
  },
  {
    id: 'med-13-concurrent-task-pool',
    name: 'Concurrent Task Pool with AbortSignal',
    tier: 'medium',
    points: 2.0,
    description: 'Create TaskPool(concurrency) with add(task), onProgress, and abort()',
    prompt: 'Create taskPool.ts exporting class TaskPool with concurrency limit, add<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>, and abortAll(): void.',
    assert: async (ctx) => {
      const code = await ctx.readFile('taskPool.ts')
      if (!code) return { ok: false, message: 'taskPool.ts missing' }
      const ok = /class\s+TaskPool/.test(code) && /concurrency/.test(code) && /AbortController|signal/.test(code)
      return { ok, message: ok ? undefined : 'TaskPool with concurrency limit and AbortSignal support required' }
    }
  },
  {
    id: 'med-14-typed-finite-state-machine',
    name: 'Strongly Typed Finite State Machine (FSM)',
    tier: 'medium',
    points: 2.0,
    description: 'Create createFSM in TypeScript with transition table and onEnter/onLeave hooks',
    prompt: 'Create fsm.ts exporting function createFSM<S extends string, E extends string>(config: { initial: S; transitions: Record<S, Partial<Record<E, S>>>; onTransition?: (from: S, to: S, event: E) => void }): { getState: () => S; send: (event: E) => boolean }.',
    assert: async (ctx) => {
      const code = await ctx.readFile('fsm.ts')
      if (!code) return { ok: false, message: 'fsm.ts missing' }
      const ok = /createFSM/.test(code) && /transitions/.test(code) && /getState/.test(code) && /send/.test(code)
      return { ok, message: ok ? undefined : 'createFSM state machine factory required' }
    }
  },
  {
    id: 'med-15-sse-stream-parser',
    name: 'Server-Sent Events (SSE) Stream Decoder',
    tier: 'medium',
    points: 2.0,
    description: 'Create parseSSE(stream) yielding parsed event, id, data objects',
    prompt: 'Create sseParser.ts exporting async function* parseSSE(stream: AsyncIterable<string>): AsyncIterableIterator<{ event?: string; data: string; id?: string }> handling double newline boundaries.',
    assert: async (ctx) => {
      const code = await ctx.readFile('sseParser.ts')
      if (!code) return { ok: false, message: 'sseParser.ts missing' }
      const ok = /parseSSE/.test(code) && /async\s+function\s*\*/.test(code) && /data:/.test(code)
      return { ok, message: ok ? undefined : 'parseSSE async generator required' }
    }
  },
  {
    id: 'med-16-persistent-vector-trie',
    name: 'Persistent Immutable Vector Data Structure',
    tier: 'medium',
    points: 2.0,
    description: 'Create persistentVector.ts with structural sharing push, get, set',
    prompt: 'Create persistentVector.ts exporting class PersistentVector<T> with push(item: T): PersistentVector<T>, get(index: number): T, and set(index: number, item: T): PersistentVector<T> utilizing structural sharing.',
    assert: async (ctx) => {
      const code = await ctx.readFile('persistentVector.ts')
      if (!code) return { ok: false, message: 'persistentVector.ts missing' }
      const ok = /PersistentVector/.test(code) && /push\(/.test(code) && /get\(/.test(code) && /set\(/.test(code)
      return { ok, message: ok ? undefined : 'PersistentVector with immutable operations required' }
    }
  },
  {
    id: 'med-17-markdown-ast-tokenizer',
    name: 'Markdown Parser to Structured AST',
    tier: 'medium',
    points: 2.0,
    description: 'Create parseMarkdown(md) returning nodes for headings, code blocks, lists',
    prompt: 'Create markdownAst.ts exporting function parseMarkdown(src: string): Array<{ type: "heading" | "code" | "paragraph" | "list"; content: string; depth?: number; lang?: string }>.',
    assert: async (ctx) => {
      const code = await ctx.readFile('markdownAst.ts')
      if (!code) return { ok: false, message: 'markdownAst.ts missing' }
      const ok = /parseMarkdown/.test(code) && /heading/.test(code) && /code/.test(code)
      return { ok, message: ok ? undefined : 'parseMarkdown AST parser required' }
    }
  },
  {
    id: 'med-18-onion-middleware-pipeline',
    name: 'Koa-Style Onion Middleware Pipeline',
    tier: 'medium',
    points: 2.0,
    description: 'Create compose(middlewares) executing next() chains downstream and upstream',
    prompt: 'Create middleware.ts exporting compose(middlewares: Array<(ctx: any, next: () => Promise<void>) => Promise<void>>): (ctx: any) => Promise<void> matching Koa onion pipeline.',
    assert: async (ctx) => {
      const code = await ctx.readFile('middleware.ts')
      if (!code) return { ok: false, message: 'middleware.ts missing' }
      const ok = /compose/.test(code) && /next/.test(code) && /Promise\.resolve/.test(code)
      return { ok, message: ok ? undefined : 'compose middleware pipeline required' }
    }
  },
  {
    id: 'med-19-react-undo-redo-reducer',
    name: 'Undo/Redo State History Reducer',
    tier: 'medium',
    points: 2.0,
    description: 'Create createUndoableReducer(reducer, limit) with past, present, future stacks',
    prompt: 'Create undoable.ts exporting function createUndoableReducer<S, A>(reducer: (state: S, action: A) => S, maxHistory = 50): (state: { past: S[]; present: S; future: S[] }, action: A | { type: "UNDO" } | { type: "REDO" }) => any.',
    assert: async (ctx) => {
      const code = await ctx.readFile('undoable.ts')
      if (!code) return { ok: false, message: 'undoable.ts missing' }
      const ok = /createUndoableReducer/.test(code) && /UNDO/.test(code) && /REDO/.test(code) && /past/.test(code)
      return { ok, message: ok ? undefined : 'createUndoableReducer with past/present/future required' }
    }
  },
  {
    id: 'med-20-binary-tlv-protocol-codec',
    name: 'Binary TLV (Type-Length-Value) Protocol Codec',
    tier: 'medium',
    points: 2.0,
    description: 'Create encodeTLV and decodeTLV packing tags, length headers, and payload Buffers',
    prompt: 'Create tlv.ts exporting encodeTLV(tag: number, value: Buffer): Buffer and decodeTLV(buffer: Buffer): Array<{ tag: number; value: Buffer }>.',
    assert: async (ctx) => {
      const code = await ctx.readFile('tlv.ts')
      if (!code) return { ok: false, message: 'tlv.ts missing' }
      const ok = /encodeTLV/.test(code) && /decodeTLV/.test(code) && /Buffer/.test(code)
      return { ok, message: ok ? undefined : 'encodeTLV and decodeTLV buffer handlers required' }
    }
  },
  {
    id: 'med-21-dijkstra-graph-search',
    name: 'Dijkstra Shortest Path Finder',
    tier: 'medium',
    points: 2.0,
    description: 'Create dijkstra.ts finding lowest cost path in weighted graph',
    prompt: 'Create dijkstra.ts exporting findShortestPath(graph: Record<string, Record<string, number>>, start: string, end: string): { path: string[]; distance: number } | null.',
    assert: async (ctx) => {
      const code = await ctx.readFile('dijkstra.ts')
      if (!code) return { ok: false, message: 'dijkstra.ts missing' }
      const ok = /findShortestPath/.test(code) && /distance/.test(code) && /visited|unvisited|pq/i.test(code)
      return { ok, message: ok ? undefined : 'findShortestPath Dijkstra algorithm required' }
    }
  },
  {
    id: 'med-22-micro-template-compiler',
    name: 'Micro-Template Compiler (if / each)',
    tier: 'medium',
    points: 2.0,
    description: 'Create compileTemplate.ts supporting {{#if cond}} and {{#each list}} blocks',
    prompt: 'Create compileTemplate.ts exporting compile(template: string): (context: any) => string supporting {{#if key}}...{{/if}} and {{#each items}}...{{/each}} blocks.',
    assert: async (ctx) => {
      const code = await ctx.readFile('compileTemplate.ts')
      if (!code) return { ok: false, message: 'compileTemplate.ts missing' }
      const ok = /compile/.test(code) && /#if/.test(code) && /#each/.test(code)
      return { ok, message: ok ? undefined : 'compile supporting #if and #each required' }
    }
  },
  {
    id: 'med-23-promisified-fs-watcher',
    name: 'Debounced Async Filesystem Watcher',
    tier: 'medium',
    points: 2.0,
    description: 'Create watchFiles(dir, delayMs) emitting batched change arrays',
    prompt: 'Create watchDir.ts exporting function watchDebounced(dir: string, delayMs = 100, onChange: (files: string[]) => void): () => void using fs.watch.',
    assert: async (ctx) => {
      const code = await ctx.readFile('watchDir.ts')
      if (!code) return { ok: false, message: 'watchDir.ts missing' }
      const ok = /watchDebounced/.test(code) && /fs\.watch|watch\(/.test(code) && /setTimeout/.test(code)
      return { ok, message: ok ? undefined : 'watchDebounced with debounce buffer required' }
    }
  },
  {
    id: 'med-24-multi-field-search-index',
    name: 'Weighted Multi-Field In-Memory Search Index',
    tier: 'medium',
    points: 2.0,
    description: 'Create SearchIndex class with document weighting and token score aggregation',
    prompt: 'Create searchIndex.ts exporting class SearchIndex<T extends { id: string }> with add(doc: T, weights: Record<keyof T, number>) and search(query: string): Array<{ doc: T; score: number }> using BM25/TF-IDF.',
    assert: async (ctx) => {
      const code = await ctx.readFile('searchIndex.ts')
      if (!code) return { ok: false, message: 'searchIndex.ts missing' }
      const ok = /class\s+SearchIndex/.test(code) && /search\(/.test(code) && /score/.test(code)
      return { ok, message: ok ? undefined : 'SearchIndex class with weighted scoring required' }
    }
  },
  {
    id: 'med-25-json-patch-rfc6902',
    name: 'JSON Patch (RFC 6902) Applicator',
    tier: 'medium',
    points: 2.0,
    description: 'Create applyPatch(doc, patches) supporting add, remove, replace, move, copy, test',
    prompt: 'Create jsonPatch.ts exporting applyPatch<T>(doc: T, patches: Array<{ op: "add"|"remove"|"replace"|"move"|"copy"|"test"; path: string; value?: any; from?: string }>): T.',
    assert: async (ctx) => {
      const code = await ctx.readFile('jsonPatch.ts')
      if (!code) return { ok: false, message: 'jsonPatch.ts missing' }
      const ok = /applyPatch/.test(code) && /add/.test(code) && /remove/.test(code) && /replace/.test(code)
      return { ok, message: ok ? undefined : 'applyPatch RFC 6902 operations required' }
    }
  },
  {
    id: 'med-26-event-listener-leak-detector',
    name: 'EventEmitter Listener Leak Detector',
    tier: 'medium',
    points: 2.0,
    description: 'Create trackListeners(emitter, maxThreshold) warning on unbounded listeners',
    prompt: 'Create leakDetector.ts exporting trackEmitter(emitter: any, warningLimit = 10): { getActiveCounts: () => Record<string, number>; stop: () => void } wrapping addListener/removeListener.',
    assert: async (ctx) => {
      const code = await ctx.readFile('leakDetector.ts')
      if (!code) return { ok: false, message: 'leakDetector.ts missing' }
      const ok = /trackEmitter/.test(code) && (/on\(|addListener/.test(code))
      return { ok, message: ok ? undefined : 'trackEmitter wrapper required' }
    }
  },
  {
    id: 'med-27-virtualized-list-calculator',
    name: 'Virtualized List Window Calculation Hook',
    tier: 'medium',
    points: 2.0,
    description: 'Create computeVirtualWindow(scrollTop, containerHeight, itemHeight, totalItems, overscan)',
    prompt: 'Create virtualList.ts exporting computeVirtualWindow(opts: { scrollTop: number; containerHeight: number; itemHeight: number; totalCount: number; overscan?: number }): { startIndex: number; endIndex: number; offsetY: number; totalHeight: number }.',
    assert: async (ctx) => {
      const code = await ctx.readFile('virtualList.ts')
      if (!code) return { ok: false, message: 'virtualList.ts missing' }
      const ok = /computeVirtualWindow/.test(code) && /startIndex/.test(code) && /endIndex/.test(code) && /offsetY/.test(code)
      return { ok, message: ok ? undefined : 'computeVirtualWindow math calculation required' }
    }
  },
  {
    id: 'med-28-async-memoize-ttl-dedup',
    name: 'Async Memoize with In-Flight Deduplication & TTL',
    tier: 'medium',
    points: 2.0,
    description: 'Create memoizeAsync(fn, { ttlMs, keyFn }) sharing in-flight promises',
    prompt: 'Create memoizeAsync.ts exporting function memoizeAsync<T>(fn: (...args: any[]) => Promise<T>, opts: { ttlMs: number; keyFn?: (...args: any[]) => string }): (...args: any[]) => Promise<T> preventing redundant concurrent calls.',
    assert: async (ctx) => {
      const code = await ctx.readFile('memoizeAsync.ts')
      if (!code) return { ok: false, message: 'memoizeAsync.ts missing' }
      const ok = /memoizeAsync/.test(code) && /Map/.test(code) && /Date\.now|ttl/.test(code)
      return { ok, message: ok ? undefined : 'memoizeAsync with TTL map and in-flight promise caching required' }
    }
  },
  {
    id: 'med-29-cli-interactive-wizard',
    name: 'Interactive CLI Stepper State Manager',
    tier: 'medium',
    points: 2.0,
    description: 'Create Wizard class managing step validation, forward/backward navigation, answers',
    prompt: 'Create wizard.ts exporting class Wizard<T extends Record<string, any>> with addStep(key: keyof T, validate: (val: any) => boolean | string), next(val: any), back(), and getAnswers(): T.',
    assert: async (ctx) => {
      const code = await ctx.readFile('wizard.ts')
      if (!code) return { ok: false, message: 'wizard.ts missing' }
      const ok = /class\s+Wizard/.test(code) && /addStep/.test(code) && /next\(/.test(code) && /back\(/.test(code)
      return { ok, message: ok ? undefined : 'Wizard class with addStep/next/back required' }
    }
  },
  {
    id: 'med-30-vitest-custom-matcher-extension',
    name: 'Custom Vitest Assertion Matcher Extension',
    tier: 'medium',
    points: 2.0,
    description: 'Create matchers.ts extending Vitest expect with toBeWithinRange(floor, ceiling)',
    prompt: 'Create matchers.ts exporting custom Vitest matcher toBeWithinRange(received: number, min: number, max: number) with pass boolean and message function.',
    assert: async (ctx) => {
      const code = await ctx.readFile('matchers.ts')
      if (!code) return { ok: false, message: 'matchers.ts missing' }
      const ok = /toBeWithinRange/.test(code) && /pass:/.test(code) && /message:/.test(code)
      return { ok, message: ok ? undefined : 'toBeWithinRange custom matcher returning pass/message required' }
    }
  },

  // =========================================================================
  // HARD (15 tasks x 4.0 pts = 60.0 raw pts)
  // =========================================================================
  {
    id: 'hard-01-mini-lsm-storage-engine',
    name: 'Mini-LSM Tree Storage Engine with WAL & SSTables',
    tier: 'hard',
    points: 4.0,
    description: 'Implement LSMTree engine with disk WAL log, in-memory MemTable, SSTable flushes, and crash recovery',
    prompt: 'Create lsmTree.ts exporting class LSMTree with constructor(dir: string, memtableLimit = 5), put(key: string, value: string): Promise<void> appending to wal.log, auto-flushing to sstable-[timestamp].json files, get(key: string): Promise<string | null>, and recover(): Promise<void>.',
    assert: async (ctx) => {
      const code = await ctx.readFile('lsmTree.ts')
      if (!code) return { ok: false, message: 'lsmTree.ts not created' }
      const hasClass = /class\s+LSMTree/.test(code)
      const hasWal = /wal\.log/.test(code) || /appendFile|writeFile/.test(code)
      const hasFlush = /sstable/i.test(code)
      const hasRecover = /recover\(/.test(code)
      const ok = hasClass && hasWal && hasFlush && hasRecover
      return { ok, message: ok ? undefined : 'LSMTree class must implement WAL logging, SSTable flush, and recover() logic' }
    }
  },
  {
    id: 'hard-02-two-phase-commit-consensus',
    name: 'Two-Phase Commit (2PC) Distributed Transaction Coordinator',
    tier: 'hard',
    points: 4.0,
    description: 'Implement Coordinator and Participant classes with Prepare/Commit phases, timeouts, and rollback',
    prompt: 'Create twoPhaseCommit.ts exporting Coordinator and Participant classes. Coordinator.executeTransaction(participants: Participant[], data: any): Promise<boolean> performs PREPARE phase, checks unanimous VOTE_COMMIT, and broadcasts GLOBAL_COMMIT or GLOBAL_ABORT with rollback.',
    assert: async (ctx) => {
      const code = await ctx.readFile('twoPhaseCommit.ts')
      if (!code) return { ok: false, message: 'twoPhaseCommit.ts not created' }
      const hasCoordinator = /class\s+Coordinator/.test(code)
      const hasParticipant = /class\s+Participant/.test(code)
      const hasPrepare = /prepare/i.test(code)
      const hasCommitAbort = /commit/i.test(code) && /abort/i.test(code)
      const ok = hasCoordinator && hasParticipant && hasPrepare && hasCommitAbort
      return { ok, message: ok ? undefined : '2PC Coordinator and Participant classes with Prepare/Commit/Abort phases required' }
    }
  },
  {
    id: 'hard-03-commonjs-to-esm-transformer',
    name: 'Multi-File CommonJS to ESM Code Transformer',
    tier: 'hard',
    points: 4.0,
    description: 'Transform 4 interdependent CommonJS files with require/exports to pure ES Modules',
    prompt: 'Convert utils.cjs, math.cjs, service.cjs, and index.cjs in workspace to ES Modules (.js) using import, export default, export { ... }, and import.meta.url.',
    initialFiles: {
      'utils.cjs': 'const path = require("path"); exports.format = (s) => s.trim(); exports.base = __dirname;',
      'math.cjs': 'const { format } = require("./utils.cjs"); module.exports = { add: (a, b) => a + b };',
      'service.cjs': 'const math = require("./math.cjs"); exports.calculate = (x) => math.add(x, 10);',
      'index.cjs': 'const service = require("./service.cjs"); console.log(service.calculate(5));'
    },
    assert: async (ctx) => {
      const utils = await ctx.readFile('utils.js') || await ctx.readFile('utils.mjs')
      const math = await ctx.readFile('math.js') || await ctx.readFile('math.mjs')
      const service = await ctx.readFile('service.js') || await ctx.readFile('service.mjs')
      if (!utils || !math || !service) return { ok: false, message: 'Transformed ESM files (utils.js, math.js, service.js) not found' }
      const hasImport = /import\s+/.test(utils) || /import\s+/.test(math)
      const hasExport = /export\s+/.test(utils) && /export\s+/.test(math)
      const noRequire = !/require\(/.test(math)
      const ok = hasImport && hasExport && noRequire
      return { ok, message: ok ? undefined : 'Files must use ESM import/export statements and eliminate require()' }
    }
  },
  {
    id: 'hard-04-distributed-task-queue-dlq',
    name: 'Distributed Task Queue with DLQ & Jittered Backoff',
    tier: 'hard',
    points: 4.0,
    description: 'Create TaskQueue engine with worker concurrency, dead-letter routing, and idempotency dedup',
    prompt: 'Create taskQueue.ts exporting TaskQueue class with concurrency limit, enqueue(job: { id: string; payload: any; maxRetries?: number }), deadLetterQueue storage, idempotency deduplication window, and exponential backoff retries.',
    assert: async (ctx) => {
      const code = await ctx.readFile('taskQueue.ts')
      if (!code) return { ok: false, message: 'taskQueue.ts not created' }
      const hasQueue = /class\s+TaskQueue/.test(code)
      const hasDlq = /deadLetter|dlq/i.test(code)
      const hasRetry = /retry|backoff|attempt/i.test(code)
      const ok = hasQueue && hasDlq && hasRetry
      return { ok, message: ok ? undefined : 'TaskQueue with concurrency, Dead-Letter Queue, and retry backoff required' }
    }
  },
  {
    id: 'hard-05-self-healing-router-bug-hunt',
    name: 'Self-Healing Multi-File Bug Investigation & Fix (3 Interconnected Bugs)',
    tier: 'hard',
    points: 4.0,
    description: 'Diagnose and fix regex matching, double-next error trapping, and header duplicate bugs across 4 files',
    prompt: 'The mini-server in src/ (router.ts, middleware.ts, response.ts, server.ts) has 3 bugs causing test.ts to fail. Find and fix all 3 bugs so test.ts passes.',
    initialFiles: {
      'src/router.ts': 'export function matchRoute(pattern: string, path: string) { const regex = new RegExp("^" + pattern + "$"); return regex.test(path); }',
      'src/middleware.ts': 'export async function errorHandler(ctx: any, next: any) { try { await next(); } catch (err) { ctx.status = 500; await next(); } }',
      'src/response.ts': 'export function setHeader(res: any, key: string, val: string) { res.headers = res.headers || {}; res.headers[key] = (res.headers[key] ? res.headers[key] + "," : "") + val; }',
      'test.ts': b64('aW1wb3J0IHsgbWF0Y2hSb3V0ZSB9IGZyb20gIi4vc3JjL3JvdXRlciI7IGltcG9ydCB7IGVycm9ySGFuZGxlciB9IGZyb20gIi4vc3JjL21pZGRsZXdhcmUiOyBjb25zb2xlLmxvZyhtYXRjaFJvdXRlKCIvdXNlcnMvOmlkIiwgIi91c2Vycy80MiIpKTs=')
    },
    assert: async (ctx) => {
      const mw = await ctx.readFile('src/middleware.ts')
      const router = await ctx.readFile('src/router.ts')
      if (!mw || !router) return { ok: false, message: 'Source files missing' }
      const mwFixed = !/catch\s*\(err\)\s*\{\s*ctx\.status\s*=\s*500;\s*await\s+next\(\);/i.test(mw)
      const routerFixed = /:([a-zA-Z0-9_]+)/.test(router) || /\\d\+|[^/]+/.test(router)
      const ok = mwFixed && routerFixed
      return { ok, message: ok ? undefined : 'errorHandler double-next bug and route parameter matching bug must be fixed' }
    }
  },
  {
    id: 'hard-06-ast-code-linter-fixer',
    name: 'AST-Based Linter and Auto-Fixer',
    tier: 'hard',
    points: 4.0,
    description: 'Create linter.ts detecting and auto-fixing console.log, any types, and unused imports',
    prompt: 'Create linter.ts exporting function lintAndFix(code: string): { fixedCode: string; issuesFound: number } that removes console.log(...) statements and replaces ": any" with ": unknown".',
    assert: async (ctx) => {
      const code = await ctx.readFile('linter.ts')
      if (!code) return { ok: false, message: 'linter.ts not created' }
      const ok = /lintAndFix/.test(code) && /console\.log/.test(code) && (/unknown/.test(code) || /any/.test(code))
      return { ok, message: ok ? undefined : 'lintAndFix function removing console.log and replacing any required' }
    }
  },
  {
    id: 'hard-07-b-tree-indexing-engine',
    name: 'In-Memory B-Tree Index Engine',
    tier: 'hard',
    points: 4.0,
    description: 'Implement BTree of order M with search, insert, node splitting, and range query',
    prompt: 'Create btree.ts exporting class BTree<K, V> with order M, insert(key: K, val: V): void, search(key: K): V | undefined, rangeSearch(min: K, max: K): V[], and node splitting on overflow.',
    assert: async (ctx) => {
      const code = await ctx.readFile('btree.ts')
      if (!code) return { ok: false, message: 'btree.ts not created' }
      const ok = /class\s+BTree/.test(code) && /insert\(/.test(code) && /search\(/.test(code) && (/split|order|children|keys/i.test(code))
      return { ok, message: ok ? undefined : 'BTree class with insert, search, and split logic required' }
    }
  },
  {
    id: 'hard-08-in-memory-sql-query-engine',
    name: 'Reactive SQL Query Engine on In-Memory Collections',
    tier: 'hard',
    points: 4.0,
    description: 'Create sqlEngine.ts parsing and executing SELECT, WHERE, JOIN, and GROUP BY',
    prompt: 'Create sqlEngine.ts exporting executeSql(query: string, tables: Record<string, any[]>): any[] supporting SELECT fields, WHERE conditions, and INNER JOIN.',
    assert: async (ctx) => {
      const code = await ctx.readFile('sqlEngine.ts')
      if (!code) return { ok: false, message: 'sqlEngine.ts not created' }
      const ok = /executeSql/.test(code) && /SELECT/i.test(code) && /WHERE/i.test(code) && /JOIN/i.test(code)
      return { ok, message: ok ? undefined : 'executeSql supporting SELECT, WHERE, and JOIN required' }
    }
  },
  {
    id: 'hard-09-mini-git-object-engine',
    name: 'Mini Git Object and Commit Tree Engine',
    tier: 'hard',
    points: 4.0,
    description: 'Implement hash-object, write-tree, and commit-tree generating real Git SHA-1 hashes',
    prompt: 'Create miniGit.ts exporting hashObject(content: string, type = "blob"): string, writeTree(entries: Array<{ mode: string; path: string; sha: string }>): string, and createCommit(treeSha: string, parentSha: string | null, message: string): string using Node.js crypto sha1.',
    assert: async (ctx) => {
      const code = await ctx.readFile('miniGit.ts')
      if (!code) return { ok: false, message: 'miniGit.ts not created' }
      const ok = /hashObject/.test(code) && /writeTree/.test(code) && /createCommit/.test(code) && /sha1/i.test(code)
      return { ok, message: ok ? undefined : 'miniGit.ts with Git object SHA-1 hashing required' }
    }
  },
  {
    id: 'hard-10-bytecode-vm-assembler',
    name: 'Stack-Based Bytecode VM & Assembler',
    tier: 'hard',
    points: 4.0,
    description: 'Implement Bytecode Assembler and Stack VM executing arithmetic, jumps, and register memory',
    prompt: 'Create vm.ts exporting assemble(assemblyCode: string): Uint8Array and class StackVM with execute(bytecode: Uint8Array): number supporting PUSH, POP, ADD, SUB, MUL, JMP, JZ, and HALT.',
    assert: async (ctx) => {
      const code = await ctx.readFile('vm.ts')
      if (!code) return { ok: false, message: 'vm.ts not created' }
      const ok = /assemble/.test(code) && /class\s+StackVM/.test(code) && /PUSH|ADD|JMP|HALT/i.test(code)
      return { ok, message: ok ? undefined : 'assemble and StackVM with opcode execution required' }
    }
  },
  {
    id: 'hard-11-crdt-replicated-text',
    name: 'CRDT (Conflict-Free Replicated Data Type) Text Document',
    tier: 'hard',
    points: 4.0,
    description: 'Implement RGA/LSEQ collaborative text editor converging without a central coordinator',
    prompt: 'Create crdtText.ts exporting class CRDTDoc with siteId, insert(char: string, index: number): Operation, delete(index: number): Operation, applyRemote(op: Operation): void, and getText(): string ensuring deterministic convergence.',
    assert: async (ctx) => {
      const code = await ctx.readFile('crdtText.ts')
      if (!code) return { ok: false, message: 'crdtText.ts not created' }
      const ok = /class\s+CRDTDoc/.test(code) && /insert\(/.test(code) && /applyRemote/.test(code) && /getText/.test(code)
      return { ok, message: ok ? undefined : 'CRDTDoc class with local insert and applyRemote operations required' }
    }
  },
  {
    id: 'hard-12-wasm-binary-header-parser',
    name: 'WebAssembly Binary Module Header & Section Parser',
    tier: 'hard',
    points: 4.0,
    description: 'Parse WASM binary magic number (0x00 0x61 0x73 0x6d), version, and section headers',
    prompt: 'Create wasmParser.ts exporting parseWasmModule(buf: Buffer): { version: number; sections: Array<{ id: number; name: string; size: number }> } verifying WASM magic bytes.',
    assert: async (ctx) => {
      const code = await ctx.readFile('wasmParser.ts')
      if (!code) return { ok: false, message: 'wasmParser.ts not created' }
      const ok = /parseWasmModule/.test(code) && /0x61|0x73|0x6d|asm/i.test(code) && /sections/.test(code)
      return { ok, message: ok ? undefined : 'parseWasmModule checking magic bytes and section IDs required' }
    }
  },
  {
    id: 'hard-13-streaming-sax-json-parser',
    name: 'Streaming Event-Driven SAX JSON Parser',
    tier: 'hard',
    points: 4.0,
    description: 'Parse large JSON chunk by chunk emitting startObject, key, value, endObject without loading into RAM',
    prompt: 'Create streamJson.ts exporting class StreamingJsonParser with write(chunk: string): void, on(event: "startObject"|"endObject"|"key"|"value", cb: Function), and state machine stack.',
    assert: async (ctx) => {
      const code = await ctx.readFile('streamJson.ts')
      if (!code) return { ok: false, message: 'streamJson.ts not created' }
      const ok = /StreamingJsonParser/.test(code) && /write\(/.test(code) && /startObject|endObject/.test(code)
      return { ok, message: ok ? undefined : 'StreamingJsonParser with streaming token emission required' }
    }
  },
  {
    id: 'hard-14-dynamic-memory-allocator',
    name: 'Dynamic Memory Pool Allocator (Buddy / Slab Allocation)',
    tier: 'hard',
    points: 4.0,
    description: 'Create fixed-size buffer memory allocator with malloc, free, and coalescing',
    prompt: 'Create memoryPool.ts exporting class MemoryPool with constructor(totalBytes: number), malloc(sizeBytes: number): number, free(ptr: number): void, and getFragmentation(): number with block coalescing.',
    assert: async (ctx) => {
      const code = await ctx.readFile('memoryPool.ts')
      if (!code) return { ok: false, message: 'memoryPool.ts not created' }
      const ok = /class\s+MemoryPool/.test(code) && /malloc\(/.test(code) && /free\(/.test(code)
      return { ok, message: ok ? undefined : 'MemoryPool with malloc, free, and coalescing required' }
    }
  },
  {
    id: 'hard-15-zero-knowledge-debugger',
    name: 'Autonomous Multi-Step Integration Debugger',
    tier: 'hard',
    points: 4.0,
    description: 'Investigate broken integration environment, fix async race condition, and export report',
    prompt: 'Inspect brokenApp.ts. Identify why the async worker pool deadlocks under concurrent load, fix the bug in brokenApp.ts, and write the root cause analysis into postmortem.md.',
    initialFiles: {
      'brokenApp.ts': 'export class WorkerPool { private active = 0; private queue: Function[] = []; async run(task: () => Promise<void>) { if (this.active >= 2) { return new Promise(r => this.queue.push(r)); } this.active++; await task(); this.active--; const next = this.queue.shift(); if (next) next(); } }'
    },
    assert: async (ctx) => {
      const postmortem = await ctx.readFile('postmortem.md')
      const app = await ctx.readFile('brokenApp.ts')
      if (!postmortem || !app) return { ok: false, message: 'postmortem.md or brokenApp.ts missing' }
      const fixed = /while|runTask|active\+\+|finally/i.test(app)
      const hasAnalysis = /deadlock|queue|concurrency|race/i.test(postmortem)
      const ok = fixed && hasAnalysis
      return { ok, message: ok ? undefined : 'WorkerPool deadlock bug must be fixed and documented in postmortem.md' }
    }
  },

  // =========================================================================
  // HELL (5 tasks x 8.0 pts = 40.0 raw pts)
  // =========================================================================
  {
    id: 'hell-01-relational-sql-engine-bplus-tree',
    name: 'Relational Database Engine with B+ Tree Index & ACID Transactions',
    tier: 'hell',
    points: 8.0,
    description: 'Build full in-memory SQL engine: AST lexer/parser, B+Tree indexing, and BEGIN/COMMIT/ROLLBACK transactions',
    prompt: 'Create sqlEngine.ts exporting class RelationalDatabase with execute(sql: string): any[]. Must support CREATE TABLE, INSERT INTO, SELECT ... WHERE col = val ORDER BY col LIMIT n, UPDATE, DELETE, B+ Tree indexing on primary keys, and BEGIN, COMMIT, ROLLBACK transaction rollback state snapshots.',
    assert: async (ctx) => {
      const code = await ctx.readFile('sqlEngine.ts')
      if (!code) return { ok: false, message: 'sqlEngine.ts not created' }
      const hasClass = /class\s+RelationalDatabase/.test(code)
      const hasBPlus = /BPlusTree|BTree|Index|Node|leaf/i.test(code)
      const hasTransactions = /BEGIN|COMMIT|ROLLBACK/i.test(code)
      const hasCrud = /CREATE|INSERT|SELECT|UPDATE|DELETE/i.test(code)
      const ok = hasClass && hasBPlus && hasTransactions && hasCrud
      return { ok, message: ok ? undefined : 'RelationalDatabase must implement B+ Tree index, CRUD parser, and BEGIN/COMMIT/ROLLBACK transactions' }
    }
  },
  {
    id: 'hell-02-scheme-lisp-compiler-tco-vm',
    name: 'Self-Bootstrapping Micro-Lisp / Scheme Compiler & Bytecode VM with TCO',
    tier: 'hell',
    points: 8.0,
    description: 'Implement S-expression compiler, lexical closures, macro expansion, and VM with Tail-Call Optimization',
    prompt: 'Create lispVM.ts exporting function compileScheme(src: string): Uint8Array and class SchemeVM with run(bytecode: Uint8Array): any. Must parse S-expressions (define, lambda, if, let, quote), support closures, and execute recursive loops with Tail-Call Optimization (TCO) without call stack overflow.',
    assert: async (ctx) => {
      const code = await ctx.readFile('lispVM.ts')
      if (!code) return { ok: false, message: 'lispVM.ts not created' }
      const hasCompiler = /compileScheme/.test(code)
      const hasVm = /class\s+SchemeVM/.test(code)
      const hasTco = /tco|tail|trampoline|loop/i.test(code)
      const hasKeywords = /lambda|define|quote/i.test(code)
      const ok = hasCompiler && hasVm && hasTco && hasKeywords
      return { ok, message: ok ? undefined : 'Scheme compiler and VM with Tail-Call Optimization (TCO) required' }
    }
  },
  {
    id: 'hell-03-raft-consensus-cluster-simulator',
    name: 'Distributed Raft Consensus Cluster Simulator with Log Compaction',
    tier: 'hell',
    points: 8.0,
    description: 'Implement 3-node Raft consensus cluster with leader election, log replication, snapshotting, and network partition recovery',
    prompt: 'Create raft.ts exporting class RaftNode with states (Follower, Candidate, Leader), randomized election timeouts, RequestVote and AppendEntries RPC handlers, log commit index tracking, InstallSnapshot log compaction, and network partition resilience.',
    assert: async (ctx) => {
      const code = await ctx.readFile('raft.ts')
      if (!code) return { ok: false, message: 'raft.ts not created' }
      const hasNode = /class\s+RaftNode/.test(code)
      const hasStates = /Follower/i.test(code) && /Candidate/i.test(code) && /Leader/i.test(code)
      const hasRpcs = /RequestVote/i.test(code) && /AppendEntries/i.test(code)
      const hasSnapshot = /Snapshot|compact/i.test(code)
      const ok = hasNode && hasStates && hasRpcs && hasSnapshot
      return { ok, message: ok ? undefined : 'RaftNode with Leader Election, AppendEntries, and Log Snapshotting required' }
    }
  },
  {
    id: 'hell-04-typescript-bundler-tree-shaker',
    name: 'Multi-File TypeScript Bundler & Tree-Shaking Engine with Source Maps',
    tier: 'hell',
    points: 8.0,
    description: 'Build module dependency graph across 6 files, eliminate dead exports, isolate scopes, and output single IIFE bundle with Source Maps',
    prompt: 'Create bundler.ts exporting async function bundleProject(entryFile: string): Promise<{ code: string; map: string; deadCodeEliminated: string[] }> parsing AST import/export graphs across files, tree-shaking unused exports, and emitting a single IIFE bundle with V3 Source Map.',
    assert: async (ctx) => {
      const code = await ctx.readFile('bundler.ts')
      if (!code) return { ok: false, message: 'bundler.ts not created' }
      const hasBundle = /bundleProject/.test(code)
      const hasTreeShake = /treeShake|deadCode|unused|eliminate/i.test(code)
      const hasSourceMap = /mappings|sourceMap|version\s*:\s*3/i.test(code)
      const ok = hasBundle && hasTreeShake && hasSourceMap
      return { ok, message: ok ? undefined : 'bundleProject with AST dependency graph, tree-shaking, and Source Map generation required' }
    }
  },
  {
    id: 'hell-05-autonomous-distributed-architecture-repair',
    name: 'Autonomous Distributed Architecture Repair (5 Interdependent Bugs across 7 Files)',
    tier: 'hell',
    points: 8.0,
    description: 'Diagnose and fix JWT refresh race condition, pagination off-by-one, socket memory leak, HMAC replay attack, and 2PC deadlock across 7 files',
    prompt: 'The microservices workspace in src/ has 5 critical bugs across 7 files (auth.ts, cursor.ts, socketPool.ts, webhook.ts, txLock.ts, gateway.ts, server.ts). Diagnose all failure traces, fix all 5 bugs across the files, and write an incident root-cause report in INCIDENT_REPORT.md.',
    initialFiles: {
      'src/auth.ts': 'let isRefreshing = false; export async function refreshToken() { isRefreshing = true; const t = await fetchNewToken(); isRefreshing = false; return t; } async function fetchNewToken() { return "token_" + Date.now(); }',
      'src/cursor.ts': 'export function decodeCursor(cursor: string) { const str = Buffer.from(cursor, "base64").toString("utf8"); const offset = parseInt(str); return offset + 1; }',
      'src/socketPool.ts': 'const sockets: any[] = []; export function addSocket(s: any) { sockets.push(s); }',
      'src/webhook.ts': 'export function verifySignature(payload: string, sig: string, secret: string) { return sig === "valid"; }',
      'src/txLock.ts': 'export async function acquireLocks(lockA: string, lockB: string) { return true; }',
      'src/gateway.ts': b64('aW1wb3J0IHsgcmVmcmVzaFRva2VuIH0gZnJvbSAiLi9hdXRoIjsgZXhwb3J0IGNvbnN0IGhhbmRsZSA9ICgpID0+IHJlZnJlc2hUb2tlbigpOw=='),
      'src/server.ts': b64('aW1wb3J0IHsgaGFuZGxlIH0gZnJvbSAiLi9nYXRld2F5IjsgY29uc29sZS5sb2coaGFuZGxlKCkpOw==')
    },
    assert: async (ctx) => {
      const auth = await ctx.readFile('src/auth.ts')
      const cursor = await ctx.readFile('src/cursor.ts')
      const socketPool = await ctx.readFile('src/socketPool.ts')
      const report = await ctx.readFile('INCIDENT_REPORT.md')
      if (!auth || !cursor || !socketPool || !report) return { ok: false, message: 'Modified source files or INCIDENT_REPORT.md missing' }
      const authFixed = /refreshPromise|queue|mutex|lock/i.test(auth)
      const cursorFixed = !/offset\s*\+\s*1/.test(cursor)
      const socketFixed = /remove|close|delete|filter/i.test(socketPool)
      const hasReport = report.length > 50
      const ok = authFixed && cursorFixed && socketFixed && hasReport
      return { ok, message: ok ? undefined : 'All 5 bugs across microservice files must be fixed with comprehensive INCIDENT_REPORT.md' }
    }
  }
]

// Backwards-compatible alias for any legacy test referencing 30 scenarios
export const DATASET_30_SCENARIOS = DATASET_100_SCENARIOS
