import type { IpcResult, ToolDefinition, ToolResult } from '@shared/types'

export interface ToolContext {
  cwd: string
  timeoutMs: number
  /** Ceiling on tool output handed to the model. */
  maxOutputChars: number
}

export interface BuiltinTool {
  definition: ToolDefinition
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/** Unwrap an IpcResult, converting the failure case into a throw. */
function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const str = (input: Record<string, unknown>, key: string, fallback?: string): string => {
  const value = input[key]
  if (typeof value === 'string') return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required string argument "${key}".`)
}

const num = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return undefined
}

const bool = (input: Record<string, unknown>, key: string): boolean => {
  const value = input[key]
  return value === true || value === 'true'
}

/** Prefix each line with its 1-based number, the way a code reviewer reads it. */
function withLineNumbers(content: string, startLine: number): string {
  return content
    .split('\n')
    .map((line, i) => `${String(startLine + i).padStart(5, ' ')}\t${line}`)
    .join('\n')
}

const readFile: BuiltinTool = {
  definition: {
    name: 'read_file',
    description:
      'Read a text file, with line numbers. offset/limit for large files; over 1 MB is refused.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative to the workspace, or absolute.' },
        offset: { type: 'integer', description: '0-based first line.' },
        limit: { type: 'integer', description: 'Lines to read (default 2000).' }
      },
      required: ['path']
    }
  },
  async execute(input, ctx) {
    const offset = num(input, 'offset')
    const limit = num(input, 'limit')
    const result = unwrap(
      await window.flashgent.fs.read({
        path: str(input, 'path'),
        cwd: ctx.cwd,
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {})
      })
    )

    const header = result.truncated
      ? `(showing lines ${(offset ?? 0) + 1}-${(offset ?? 0) + result.content.split('\n').length} of ${result.totalLines})\n`
      : ''

    return {
      ok: true,
      content: header + withLineNumbers(result.content, (offset ?? 0) + 1),
      display: {
        kind: 'file',
        path: result.path,
        title: str(input, 'path'),
        truncated: result.truncated
      }
    }
  }
}

const writeFile: BuiltinTool = {
  definition: {
    name: 'write_file',
    description: 'Create or fully overwrite a file. To change part of one, use edit_file.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative to the workspace, or absolute.' },
        content: { type: 'string', description: 'Full new content.' }
      },
      required: ['path', 'content']
    }
  },
  async execute(input, ctx) {
    const content = str(input, 'content')
    const result = unwrap(
      await window.flashgent.fs.write({ path: str(input, 'path'), cwd: ctx.cwd, content })
    )
    const lines = content.split('\n').length
    return {
      ok: true,
      content: `${result.created ? 'Created' : 'Overwrote'} ${result.path} (${lines} lines).`,
      display: { kind: 'file', path: result.path, title: str(input, 'path') }
    }
  }
}

const editFile: BuiltinTool = {
  definition: {
    name: 'edit_file',
    description:
      'Replace an exact string. old_string must match exactly, indentation included, and be ' +
      'unique unless replace_all is set.',
    risk: 'write',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File to edit.' },
        old_string: { type: 'string', description: 'Exact text to find.' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence.' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  async execute(input, ctx) {
    const result = unwrap(
      await window.flashgent.fs.edit({
        path: str(input, 'path'),
        cwd: ctx.cwd,
        oldString: str(input, 'old_string'),
        newString: str(input, 'new_string'),
        replaceAll: bool(input, 'replace_all')
      })
    )
    return {
      ok: true,
      content: `Applied ${result.replacements} replacement(s) in ${result.path}.\n\n${result.diff}`,
      display: { kind: 'diff', path: result.path, title: str(input, 'path'), language: 'diff' }
    }
  }
}

const glob: BuiltinTool = {
  definition: {
    name: 'glob',
    description: 'Find files by glob (e.g. src/**/*.ts), newest first. Respects .gitignore.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Relative to the workspace.' },
        limit: { type: 'integer', description: 'Max results (default 500).' }
      },
      required: ['pattern']
    }
  },
  async execute(input, ctx) {
    const limit = num(input, 'limit')
    const files = unwrap(
      await window.flashgent.fs.glob({
        pattern: str(input, 'pattern'),
        cwd: ctx.cwd,
        ...(limit !== undefined ? { limit } : {})
      })
    )
    return {
      ok: true,
      content: files.length ? files.join('\n') : 'No files matched.',
      display: { kind: 'list', title: `${files.length} file(s)` }
    }
  }
}

const grep: BuiltinTool = {
  definition: {
    name: 'grep',
    description: 'Search file contents by regex. Returns path:line:text. Respects .gitignore.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regex.' },
        glob: { type: 'string', description: 'Restrict to files matching this glob.' },
        case_insensitive: { type: 'boolean', description: 'Ignore case.' },
        limit: { type: 'integer', description: 'Max matches (default 200).' }
      },
      required: ['pattern']
    }
  },
  async execute(input, ctx) {
    const globPattern = input.glob
    const limit = num(input, 'limit')
    const matches = unwrap(
      await window.flashgent.fs.grep({
        pattern: str(input, 'pattern'),
        cwd: ctx.cwd,
        ...(typeof globPattern === 'string' ? { glob: globPattern } : {}),
        caseInsensitive: bool(input, 'case_insensitive'),
        ...(limit !== undefined ? { limit } : {})
      })
    )
    return {
      ok: true,
      content: matches.length
        ? matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n')
        : 'No matches.',
      display: { kind: 'list', title: `${matches.length} match(es)` }
    }
  }
}

const listDir: BuiltinTool = {
  definition: {
    name: 'list_dir',
    description: 'List a directory. Directories end in /.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Default: workspace root.' } }
    }
  },
  async execute(input, ctx) {
    const entries = unwrap(
      await window.flashgent.fs.listDir({ path: str(input, 'path', '.'), cwd: ctx.cwd })
    )
    return {
      ok: true,
      content: entries.length ? entries.join('\n') : '(empty directory)',
      display: { kind: 'list', title: str(input, 'path', '.') }
    }
  }
}

const runShell: BuiltinTool = {
  definition: {
    name: 'run_shell',
    description:
      'Run a shell command in the workspace. PowerShell on Windows by default; shell="bash" for ' +
      'POSIX. Dev servers and watchers need background=true, which returns a task id for ' +
      'shell_output instead of blocking.',
    risk: 'execute',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        shell: { type: 'string', enum: ['powershell', 'bash'] },
        background: { type: 'boolean', description: 'Detach and return a task id.' },
        timeout_ms: { type: 'integer', description: 'Foreground timeout.' }
      },
      required: ['command']
    }
  },
  async execute(input, ctx) {
    const shell = input.shell
    const timeout = num(input, 'timeout_ms')
    const background = bool(input, 'background')

    const result = unwrap(
      await window.flashgent.shell.run({
        command: str(input, 'command'),
        cwd: ctx.cwd,
        timeoutMs: timeout ?? ctx.timeoutMs,
        maxOutputChars: ctx.maxOutputChars,
        background,
        ...(shell === 'powershell' || shell === 'bash' ? { shell } : {})
      })
    )

    if (background) {
      return {
        ok: true,
        content: `Started in the background as task ${result.taskId}. Poll it with shell_output.`,
        display: { kind: 'shell', title: str(input, 'command') }
      }
    }

    const parts: string[] = []
    if (result.stdout.trim()) parts.push(result.stdout.trimEnd())
    if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.trimEnd()}`)
    if (result.timedOut) parts.push(`[timed out after ${timeout ?? ctx.timeoutMs} ms and was killed]`)
    if (!parts.length) parts.push('(no output)')
    parts.push(`[exit code ${result.exitCode ?? 'unknown'}]`)

    return {
      ok: result.exitCode === 0 && !result.timedOut,
      content: parts.join('\n'),
      display: {
        kind: 'shell',
        title: str(input, 'command'),
        exitCode: result.exitCode ?? undefined,
        truncated: result.truncated
      }
    }
  }
}

const shellOutput: BuiltinTool = {
  definition: {
    name: 'shell_output',
    description: 'Output so far from a background run_shell task.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Id returned by run_shell.' } },
      required: ['task_id']
    }
  },
  async execute(input) {
    const result = unwrap(await window.flashgent.shell.output(str(input, 'task_id')))
    const status = result.exitCode === null ? 'still running' : `exited with ${result.exitCode}`
    const body = [result.stdout, result.stderr].filter((s) => s.trim()).join('\n') || '(no output yet)'
    return {
      ok: true,
      content: `[${status}]\n${body}`,
      display: { kind: 'shell', exitCode: result.exitCode ?? undefined }
    }
  }
}

const webFetch: BuiltinTool = {
  definition: {
    name: 'web_fetch',
    // The untrusted-content rule is stated once in the system prompt; repeating
    // it on every tool would be paid for on every request.
    description: 'Fetch a URL as text (HTML reduced to plain text).',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http or https.' } },
      required: ['url']
    }
  },
  async execute(input) {
    const result = unwrap(await window.flashgent.net.fetch({ url: str(input, 'url') }))
    const note = result.truncated ? '\n\n[content truncated]' : ''
    return {
      ok: true,
      content: `${result.text}${note}`,
      display: { kind: 'plain', title: result.url, truncated: result.truncated }
    }
  }
}

const webSearch: BuiltinTool = {
  definition: {
    name: 'web_search',
    description: 'Search the web; returns titles, URLs and snippets. Supports optional site filter.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        site: { type: 'string', description: 'Optional domain restriction, e.g. "github.com".' }
      },
      required: ['query']
    }
  },
  async execute(input) {
    let q = str(input, 'query')
    const site = input.site
    if (typeof site === 'string' && site.trim()) {
      q += ` site:${site.trim()}`
    }
    const result = unwrap(await window.flashgent.net.search(q))
    return {
      ok: true,
      content: result.text,
      display: { kind: 'plain', title: `Search: ${q}` }
    }
  }
}

const directoryTree: BuiltinTool = {
  definition: {
    name: 'directory_tree',
    description:
      'Generate a visual ASCII tree of the workspace or directory. Useful to inspect project structure.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default: workspace root ".").' },
        max_depth: { type: 'integer', description: 'Maximum depth (default 3).' }
      }
    }
  },
  async execute(input, ctx) {
    const rootPath = str(input, 'path', '.')
    const maxDepth = num(input, 'max_depth') ?? 3

    const ignoreSet = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'coverage'])

    async function buildTree(relPath: string, depth: number, prefix: string): Promise<string[]> {
      if (depth > maxDepth) return []
      let entries: string[] = []
      try {
        entries = unwrap(await window.flashgent.fs.listDir({ path: relPath, cwd: ctx.cwd }))
      } catch {
        return []
      }

      const filtered = entries.filter((e) => {
        const name = e.endsWith('/') ? e.slice(0, -1) : e
        return !ignoreSet.has(name)
      })

      const lines: string[] = []
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i]
        if (!item) continue
        const isLast = i === filtered.length - 1
        const connector = isLast ? '└── ' : '├── '
        const isDir = item.endsWith('/')
        const name = item
        lines.push(`${prefix}${connector}${name}`)

        if (isDir && depth < maxDepth) {
          const nextRel = relPath === '.' ? name.slice(0, -1) : `${relPath}/${name.slice(0, -1)}`
          const nextPrefix = prefix + (isLast ? '    ' : '│   ')
          const subLines = await buildTree(nextRel, depth + 1, nextPrefix)
          lines.push(...subLines)
        }
      }
      return lines
    }

    const treeLines = await buildTree(rootPath, 1, '')
    const content = `${rootPath}/\n${treeLines.join('\n')}` || `${rootPath}/ (empty)`

    return {
      ok: true,
      content,
      display: { kind: 'plain', title: `Tree: ${rootPath}` }
    }
  }
}

const gitSummary: BuiltinTool = {
  definition: {
    name: 'git_summary',
    description: 'Get git status, current branch, and recent commit history for the workspace.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  async execute(_input, ctx) {
    const res = await window.flashgent.shell.run({
      command: 'git branch --show-current && git status --short && git log -n 5 --oneline',
      cwd: ctx.cwd,
      timeoutMs: 8000
    })

    if (!res.ok) {
      return { ok: false, content: `Not a git repo or git error: ${res.error}` }
    }

    const stdout = res.value.stdout.trim()
    return {
      ok: res.value.exitCode === 0,
      content: stdout || 'No git output or clean working directory.',
      display: { kind: 'shell', title: 'Git Summary' }
    }
  }
}

const httpRequest: BuiltinTool = {
  definition: {
    name: 'http_request',
    description:
      'Send a custom HTTP request (GET, POST, PUT, DELETE) with custom headers or JSON body. Useful for testing APIs and dev servers.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL.' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object', description: 'Key-value map of HTTP headers.' },
        body: { type: 'string', description: 'Request body (e.g. JSON string).' }
      },
      required: ['url']
    }
  },
  async execute(input) {
    const url = str(input, 'url')
    const method = str(input, 'method', 'GET').toUpperCase()
    const rawHeaders = input.headers && typeof input.headers === 'object' ? input.headers : {}
    const body = typeof input.body === 'string' ? input.body : undefined

    const headers: Record<string, string> = {
      'User-Agent': 'flashgent/0.1'
    }
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') headers[k] = v
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? body : undefined
      })

      const statusText = `HTTP ${response.status} ${response.statusText}`
      const text = await response.text()
      const preview = text.length > 50000 ? text.slice(0, 50000) + '\n...[truncated]' : text

      return {
        ok: response.ok,
        content: `[${statusText}]\n\n${preview}`,
        display: { kind: 'plain', title: `${method} ${url}` }
      }
    } catch (err) {
      return {
        ok: false,
        content: `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
}

export const BUILTIN_TOOLS: BuiltinTool[] = [
  readFile,
  writeFile,
  editFile,
  glob,
  grep,
  listDir,
  runShell,
  shellOutput,
  webFetch,
  webSearch,
  directoryTree,
  gitSummary,
  httpRequest
]

export const BUILTIN_BY_NAME = new Map(BUILTIN_TOOLS.map((t) => [t.definition.name, t]))
